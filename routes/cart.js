var express = require('express');
var router = express.Router();
var dao = require('../common_dao');
var common = require('../lib/utils');


router.get('/:userId',getCart ); //장바구니 리스트 불러오기
router.get('/reset/:userId',resetCart );  // 장바구니 비우기
router.get('/:action/:userId/:beerId/:cnt',cartControl ); // 장바구니 액션 (추가, 삭제)


async function CommonGetCart(userId){
    let sql_cart = `
    select C.count, A.* 
    from 
        (select 
            C.user_id, C.beer_id,
            B.id, B.name, B.image, B.price, B.stock,
            GROUP_CONCAT(T.name) as tags
        from 
            beers B 
            join tags_link_beers TLB on B.id = TLB.beers_id
            join tags T on TLB.tags_key = T.key
            join cart C on C.beer_id = B.id
        where 
            C.user_id = ${userId}
        group by 
            B.id 
        order by 
            count(TLB.tags_key) DESC) as A
     join cart C 
        on C.user_id = A.user_id and C.beer_id = A.beer_id;
    `
    let cart =  await dao.query(sql_cart);

    // DB에서 받아온 맥주리스트 전처리 (tags에 대한 값으로 들어온 String 타입을 과제 조건에 맞게 Array로 변경) 진행한다. 
    cart = common.preProcessBeers(cart);
    return cart;
}
/**
 * 장바구니 정보 가져오기
 * @param {number} userId 유저 아이디
 * @param {object} {result:"장바구니 조회 성공", status:200, cart:cart}
 */
async function getCart(req, res, next) {
    let userId = req.params.userId;
    let cart =  await CommonGetCart(userId)

    res.json({result:"장바구니 조회 성공", status:200, cart:cart});

}

/**
 * 장바구니 수량 변경
 * @param {string} action 카트 액션 'plus' or 'minus'  
 * @param {number} userId 상품 id 
 * @param {number} beerId 상품 id 
 * @param {number} cnt 장바구니에 담을 갯수
 * @return {object} // {result:"장바구니 추가 성공"}
 */
async function cartControl(req, res, next) {
    let beerId = req.params.beerId;
    let userId = req.params.userId;
    let cnt = Number(req.params.cnt);
    let action = req.params.action
    
    // 1. 일단 DB에 있는 상품의 재고파악
    let nowStock = await getNowStoc(beerId);

    // 2. 유저 장바구니에 있는 해당 아이템 수량 파악
    let nowCount = await getNowCount(userId, beerId);

    // 3. 장바구니 담기 액션이고, 재고가 모자랄때 리턴 펄스
    if(action == 'plus' && nowStock < cnt){
        res.json({result:`재고가 모자랍니다.`, status:500});
        return false;
    }

    // 4. 장바구니 빼기 액션인데 유저에게 상품이 없을때 리터 펄스 
    if(action == 'minus' && nowCount < 1){
        res.json({result:`장바구니에 해당 상품이 없습니다. .`, status:500});
        return false;
    }

    // 5. 업데이트 가능 조건일때 - DB 재고 업데이트 
        // action 값에 따라 재고 목표 숫자 설정
    let targetStock = action == 'plus' ? (nowStock - cnt) : (nowStock + cnt)  
    let sql_removeStock = `update beers set stock = ${targetStock} where id = ${beerId}; `;
    await dao.query(sql_removeStock);

    // 6. 업데이트 가능 조건일때 - 유저 장바구니 업데이트
        // action 값에 따라 장바구니 해당 아이탬 목표 수량 설정
    let sql_updateCart = setUpdateCartSql(action, nowCount, cnt, userId, beerId);
    await dao.query(sql_updateCart);
    

    // 7. 장바구니 현황 파악
    let cart =  await CommonGetCart(userId)

    res.json({result:"수량변경 성공", status:200, cart:cart});
}

/**
 * 장바구니 리셋
 * @param {number} userId 
 * @return {object} {result:"장바구니 비우기 성공", status:200}
 */
async function resetCart(req, res, next){
    let userId = req.params.userId;
    let sql_resetCart= `DELETE FROM cart where user_id = ${userId};`
    await dao.query(sql_resetCart);

    res.json({result:"장바구니 비우기 성공", status:200});
}

/**
 * DB에 있는 상품의 재고파악
 * @param {number} beerId 
 */
async function getNowStoc(beerId){
    
    let sql_stock = `select stock from beers where id = ${beerId};`
    let nowStock = await dao.query(sql_stock);
    nowStock = Number(nowStock[0].stock);

    return nowStock
}

/**
 * 유저 장바구니에 있는 해당 아이템 수량 파악
 * @param {number} userId 
 * @param {number} beerId 
 */
async function getNowCount(userId, beerId){
    let sql_count = `select count from cart where user_id = ${userId} and beer_id = ${beerId};`
    let nowCount = await dao.query(sql_count);
    nowCount = nowCount[0] ? Number(nowCount[0].count) : 0;
    
    return nowCount
}

/**
 * action 값에 따라 장바구니 해당 아이탬 목표 수량 설정
 */
function setUpdateCartSql(action, nowCount, cnt, userId, beerId){
    let _sql_updateCart;
    let targetCnt = action == 'plus' ? (nowCount + cnt) : (nowCount - cnt)  
    if(action == 'minus' && targetCnt == 0){
        // 신규추가 일때
        _sql_updateCart = `DELETE FROM cart where user_id = ${userId} and beer_id = ${beerId};`
    }else if (action == 'plus' && targetCnt == 1){
        // 삭제 일때
        _sql_updateCart = `INSERT INTO cart  (user_id, beer_id, count) VALUES (${userId}, ${beerId}, 1);`
    }else{
        // 수량 변경일 때 
        _sql_updateCart = `update cart set count = ${targetCnt}  where user_id = ${userId} and beer_id = ${beerId}; `;
    }
    return _sql_updateCart
}
module.exports = router;