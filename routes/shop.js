const router = require('express').Router();
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Order = require('../models/Order');

// 1. หน้าแรก: แสดงรายการสินค้า + ค้นหาชื่อ + กรองตามหมวดหมู่
router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const category = String(req.query.category || '').trim();

  // สร้างเงื่อนไขการค้นหาสำหรับ MongoDB
  const filter = {};
  if (q) {
    const safeText = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.name = { $regex: safeText, $options: 'i' }; // ค้นหาชื่อแบบไม่สนตัวพิมพ์เล็ก-ใหญ่
  }
  if (category) {
    filter.category = category; // กรองเฉพาะหมวดหมู่ที่เลือก
  }

  const products = await Product.find(filter).sort({ createdAt: -1 });
  const categories = await Product.distinct('category'); // ดึงรายชื่อหมวดหมู่ทั้งหมดที่มีใน DB

  res.render('shop/index', { products, categories, q, category });
});

// 2. หน้าดูรายละเอียดสินค้าทีละชิ้น
router.get('/products/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).send('ไม่พบเมนูนี้');
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).send('ไม่พบเมนูนี้');

  res.render('shop/detail', { product });
});

// 3. เพิ่มสินค้าลงตะกร้า (เก็บใน Session ชั่วคราวก่อนกดยืนยันสั่งซื้อ)
router.post('/cart/add/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.sendStatus(404);
  const product = await Product.findById(req.params.id);
  if (!product || product.stock < 1) return res.status(400).send('เมนูนี้หมดชั่วคราว');

  const qty = Math.max(1, parseInt(req.body.qty) || 1);
  const cart = req.session.cart || {};
  const currentQty = Math.min(Number(cart[product.id]) || 0, product.stock);
  if (currentQty + qty > product.stock) {
    const { items, total, stockIssues } = await getCartData(cart);
    return res.status(400).render('shop/cart', {
      items,
      total,
      stockIssues,
      error: `เพิ่มไม่ได้ เนื่องจากมีสินค้าในสต๊อก ${product.stock} จาน และในตะกร้ามีแล้ว ${currentQty} จาน (เพิ่มได้อีก ${product.stock - currentQty} จาน)`
    });
  }

  cart[product.id] = currentQty + qty;
  req.session.cart = cart;

  res.redirect('/cart');
});

// ฟังก์ชันช่วยดึงข้อมูลสินค้าในตะกร้าจาก MongoDB เพื่อคำนวณราคารวม
async function getCartData(cart) {
  const ids = Object.keys(cart).filter(id => mongoose.isValidObjectId(id));
  const products = await Product.find({ _id: { $in: ids } });
  const stockIssues = products
    .map(product => ({
      name: product.name,
      requestedQuantity: Number(cart[product.id]) || 0,
      stock: product.stock
    }))
    .filter(item => item.requestedQuantity > item.stock);
  const items = products
    .map(p => ({ product: p, quantity: Math.min(cart[p.id], p.stock) }))
    .filter(i => i.quantity > 0);
  const total = items.reduce((sum, i) => sum + i.quantity * i.product.price, 0);
  return { items, total, stockIssues };
}

function getStockError(stockIssues) {
  if (!stockIssues.length) return null;

  const details = stockIssues
    .map(item => `${item.name}: ในตะกร้า ${item.requestedQuantity} จาน แต่สต๊อกเหลือ ${item.stock} จาน`)
    .join(', ');
  return `สต๊อกสินค้าไม่เพียงพอ (${details}) กรุณาปรับจำนวนและกดบันทึกก่อนสั่งซื้อ`;
}

// 4. หน้าตะกร้าสินค้า
router.get('/cart', async (req, res) => {
  const { items, total, stockIssues } = await getCartData(req.session.cart || {});
  res.render('shop/cart', { items, total, stockIssues, error: getStockError(stockIssues) });
});

// 5. ปรับจำนวนสินค้าในตะกร้า
router.post('/cart/update/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.sendStatus(404);
  const product = await Product.findById(req.params.id);
  if (!product || product.stock < 1) return res.status(404).send('ไม่พบเมนูนี้หรือสินค้าหมด');

  const cart = req.session.cart || {};
  const currentQty = Number(cart[product.id]) || 0;
  const quantityText = String(req.body.qty || '');
  const enteredQuantity = /^[1-9]\d*$/.test(quantityText) ? Number(quantityText) : NaN;
  const baseQuantity = Number.isSafeInteger(enteredQuantity) ? enteredQuantity : currentQty;
  let quantity;

  if (req.body.change === 'increase') {
    quantity = baseQuantity + 1;
  } else if (req.body.change === 'decrease') {
    quantity = baseQuantity - 1;
  } else {
    quantity = enteredQuantity;
  }

  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > product.stock) {
    const { items, total, stockIssues } = await getCartData(cart);
    return res.status(400).render('shop/cart', {
      items,
      total,
      stockIssues,
      error: `กรุณาระบุจำนวนตั้งแต่ 1 ถึง ${product.stock} จาน`
    });
  }

  cart[product.id] = quantity;
  req.session.cart = cart;
  res.redirect('/cart');
});

// 6. ลบสินค้าออกจากตะกร้า
router.post('/cart/remove/:id', (req, res) => {
  if (req.session.cart) delete req.session.cart[req.params.id];
  res.redirect('/cart');
});

// 7. ยืนยันคำสั่งซื้อ -> ตัดสต็อกใน products และบันทึกเอกสารใหม่ลง orders
router.post('/checkout', async (req, res) => {
  const customerName = String(req.body.customerName || '').trim();
  const phone = String(req.body.phone || '').trim();
  const address = String(req.body.address || 'รับที่ร้าน').trim();
  const { items, total, stockIssues } = await getCartData(req.session.cart || {});

  if (stockIssues.length) {
    return res.status(409).render('shop/cart', {
      items,
      total,
      stockIssues,
      error: getStockError(stockIssues)
    });
  }

  if (!customerName || !phone || items.length === 0) {
    return res.status(400).render('shop/cart', {
      items,
      total,
      stockIssues,
      error: 'กรุณากรอกชื่อและเบอร์โทรให้ครบถ้วน'
    });
  }

  // ตัดจำนวนสต็อกสินค้าในคอลเลกชัน products
  for (const item of items) {
    const updated = await Product.updateOne(
      { _id: item.product.id, stock: { $gte: item.quantity } },
      { $inc: { stock: -item.quantity } }
    );
    if (!updated.modifiedCount) {
      return res.status(409).send('จำนวนเมนูคงเหลือมีการเปลี่ยนแปลง กรุณาตรวจสอบตะกร้าอีกครั้ง');
    }
  }

  // บันทึกคำสั่งซื้อลงคอลเลกชัน orders ใน MongoDB
  const order = await Order.create({
    customerName,
    phone,
    address,
    total,
    items: items.map(i => ({
      product: i.product.id,
      name: i.product.name,
      quantity: i.quantity,
      unitPrice: i.product.price
    }))
  });

  req.session.cart = {}; // ล้างตะกร้าหลังสั่งซื้อสำเร็จ
  res.render('shop/success', { order });
});

module.exports = router;