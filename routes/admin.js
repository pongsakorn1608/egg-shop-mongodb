const router = require('express').Router();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');

// Middleware ตรวจสอบสิทธิ์ Admin (ถ้ายังไม่ล็อกอิน ห้ามเข้าหน้าจัดการ)
function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.redirect('/admin/login');
  next();
}

// ตรวจสอบความถูกต้องของข้อมูลฟอร์มสินค้า
function validateProduct(body) {
  const price = Number(body.price);
  const stock = Number(body.stock);
  if (!body.name?.trim() || !Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0) {
    return null;
  }
  return {
    name: body.name.trim(),
    category: (body.category || 'ข้าวไข่ข้น').trim(),
    price,
    stock,
    description: (body.description || '').trim(),
    imageUrl: (body.imageUrl || 'https://placehold.co/600x400/F59E0B/FFFFFF?text=Egg+Menu').trim()
  };
}

function getOrderFormValues(order) {
  return {
    customerName: order.customerName,
    phone: order.phone,
    address: order.address,
    items: order.items.map(item => ({
      product: String(item.product || ''),
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice
    }))
  };
}

function renderOrderForm(res, order, products, form, error, status = 200) {
  return res.status(status).render('admin/order-form', {
    order,
    products,
    form,
    error
  });
}

// หน้า Login และตรวจสอบรหัสผ่าน
router.get('/login', (req, res) => res.render('admin/login', { error: null }));

router.post('/login', async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const password = String(req.body.password || '');
  const user = await User.findOne({ email });

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).render('admin/login', { error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
  }

  req.session.isAdmin = true;
  res.redirect('/admin');
});

router.post('/logout', requireAdmin, (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// หน้า Dashboard จัดการสินค้าทั้งหมด
router.get('/', requireAdmin, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const search = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filter = q ? {
    $or: [
      { name: { $regex: search, $options: 'i' } },
      { category: { $regex: search, $options: 'i' } }
    ]
  } : {};
  const products = await Product.find(filter).sort({ createdAt: -1 });
  res.render('admin/index', { products, q });
});

// เพิ่มสินค้าใหม่ (Create)
router.get('/products/new', requireAdmin, (req, res) => {
  res.render('admin/form', { product: null, error: null });
});

router.post('/products', requireAdmin, async (req, res) => {
  const data = validateProduct(req.body);
  if (!data) {
    return res.status(400).render('admin/form', { product: req.body, error: 'กรุณากรอกชื่อ ราคา และสต็อกให้ถูกต้อง' });
  }
  await Product.create(data);
  res.redirect('/admin');
});

// แก้ไขสินค้า (Update)
router.get('/products/:id/edit', requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.sendStatus(404);
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).send('ไม่พบเมนูนี้');
  res.render('admin/form', { product, error: null });
});

router.post('/products/:id/edit', requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.sendStatus(404);
  const data = validateProduct(req.body);
  if (!data) {
    return res.status(400).render('admin/form', { product: { ...req.body, _id: req.params.id }, error: 'ข้อมูลไม่ถูกต้อง' });
  }
  await Product.findByIdAndUpdate(req.params.id, data);
  res.redirect('/admin');
});

// ลบสินค้า (Delete)
router.post('/products/:id/delete', requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.sendStatus(404);
  await Product.findByIdAndDelete(req.params.id);
  res.redirect('/admin');
});

// ดูรายการคำสั่งซื้อทั้งหมดของลูกค้า
router.get('/orders', requireAdmin, async (req, res) => {
  const orders = await Order.find().sort({ createdAt: -1 });
  res.render('admin/orders', { orders });
});

router.post('/orders/:id/delete', requireAdmin, async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.sendStatus(404);
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).send('ไม่พบคำสั่งซื้อนี้');

  const quantitiesByProduct = new Map();
  for (const item of order.items) {
    const productId = String(item.product || '');
    const quantity = Number(item.quantity);
    if (mongoose.isValidObjectId(productId) && Number.isSafeInteger(quantity) && quantity > 0) {
      quantitiesByProduct.set(productId, (quantitiesByProduct.get(productId) || 0) + quantity);
    }
  }

  const restocked = [];
  let deleteConflict = false;
  try {
    for (const [productId, quantity] of quantitiesByProduct) {
      const result = await Product.updateOne(
        { _id: productId },
        { $inc: { stock: quantity } }
      );
      if (result.matchedCount) restocked.push({ productId, quantity });
    }

    const result = await Order.deleteOne({ _id: order._id, updatedAt: order.updatedAt });
    deleteConflict = !result.deletedCount;
  } catch (error) {
    try {
      for (const { productId, quantity } of restocked.reverse()) {
        const result = await Product.updateOne(
          { _id: productId },
          { $inc: { stock: -quantity } }
        );
        if (!result.matchedCount) {
          throw new Error(`ไม่สามารถย้อนการคืนสต็อกของเมนู ${productId} หลังลบคำสั่งซื้อไม่สำเร็จ`);
        }
      }
    } catch (rollbackError) {
      console.error('ย้อนการคืนสต็อกหลังลบคำสั่งซื้อไม่สำเร็จ:', rollbackError);
      return next(rollbackError);
    }
    return next(error);
  }

  if (deleteConflict) {
    try {
      for (const { productId, quantity } of restocked.reverse()) {
        const result = await Product.updateOne(
          { _id: productId },
          { $inc: { stock: -quantity } }
        );
        if (!result.matchedCount) {
          throw new Error(`ไม่สามารถย้อนการคืนสต็อกของเมนู ${productId} หลังลบคำสั่งซื้อไม่สำเร็จ`);
        }
      }
    } catch (rollbackError) {
      console.error('ย้อนการคืนสต็อกหลังลบคำสั่งซื้อไม่สำเร็จ:', rollbackError);
      return next(rollbackError);
    }
    return res.status(409).send('คำสั่งซื้อนี้ถูกแก้ไขจากหน้าจออื่น กรุณาตรวจสอบและลองใหม่');
  }

  res.redirect('/admin/orders');
});

router.get('/orders/:id/edit', requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.sendStatus(404);
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).send('ไม่พบคำสั่งซื้อนี้');

  const products = await Product.find().sort({ name: 1 });
  res.render('admin/order-form', {
    order,
    products,
    form: getOrderFormValues(order),
    error: null
  });
});

router.post('/orders/:id/edit', requireAdmin, async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.sendStatus(404);
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).send('ไม่พบคำสั่งซื้อนี้');

  const products = await Product.find().sort({ name: 1 });
  const customerName = String(req.body.customerName || '').trim();
  const phone = String(req.body.phone || '').trim();
  const address = String(req.body.address || 'รับที่ร้าน').trim();
  const productIds = [].concat(req.body.productIds || []).map(value => String(value || '').trim());
  const quantities = [].concat(req.body.quantities || []);
  const oldItemsByProduct = new Map();

  for (const item of order.items) {
    const productId = String(item.product || '');
    if (!productId) continue;
    const previous = oldItemsByProduct.get(productId);
    if (previous) {
      previous.quantity += Number(item.quantity) || 0;
    } else {
      oldItemsByProduct.set(productId, {
        quantity: Number(item.quantity) || 0,
        name: item.name,
        unitPrice: Number(item.unitPrice)
      });
    }
  }

  const form = {
    customerName,
    phone,
    address,
    items: productIds.map((product, index) => ({
      product,
      quantity: quantities[index],
      name: oldItemsByProduct.get(product)?.name
    }))
  };

  const showError = (message, status = 400) =>
    renderOrderForm(res, order, products, form, message, status);

  if (!customerName || !phone) {
    return showError('กรุณากรอกชื่อลูกค้าและเบอร์โทรให้ครบถ้วน');
  }
  if (productIds.length !== quantities.length) {
    return showError('ข้อมูลรายการเมนูไม่ครบถ้วน กรุณาตรวจสอบอีกครั้ง');
  }

  const requestedQuantities = new Map();
  for (let index = 0; index < productIds.length; index += 1) {
    const productId = productIds[index];
    if (!productId) continue;
    const quantity = Number(quantities[index]);
    if (!mongoose.isValidObjectId(productId) || !Number.isInteger(quantity) || quantity < 1) {
      return showError('กรุณาเลือกเมนูและระบุจำนวนเป็นจำนวนเต็มตั้งแต่ 1 จานขึ้นไป');
    }
    requestedQuantities.set(productId, (requestedQuantities.get(productId) || 0) + quantity);
  }

  if (!requestedQuantities.size) {
    return showError('กรุณาเลือกเมนูอย่างน้อย 1 รายการ');
  }

  const productIdsToLoad = [...new Set([
    ...oldItemsByProduct.keys(),
    ...requestedQuantities.keys()
  ])];
  const currentProducts = await Product.find({ _id: { $in: productIdsToLoad } });
  const productsById = new Map(currentProducts.map(product => [String(product._id), product]));
  const updatedItems = [];

  for (const [productId, quantity] of requestedQuantities) {
    const previous = oldItemsByProduct.get(productId);
    const product = productsById.get(productId);
    if (!product && !previous) {
      return showError('มีเมนูที่ไม่มีอยู่ในระบบ กรุณาเลือกเมนูใหม่');
    }
    updatedItems.push({
      product: productId,
      name: previous?.name || product?.name || 'เมนูที่ไม่มีในระบบ',
      quantity,
      unitPrice: Number.isFinite(previous?.unitPrice)
        ? previous.unitPrice
        : Number(product?.price) || 0
    });
  }

  const oldQuantities = new Map(
    [...oldItemsByProduct].map(([productId, item]) => [productId, item.quantity])
  );
  const stockChanges = new Map();
  for (const productId of new Set([
    ...oldQuantities.keys(),
    ...requestedQuantities.keys()
  ])) {
    if (!productsById.has(productId)) continue;
    const difference = (requestedQuantities.get(productId) || 0) - (oldQuantities.get(productId) || 0);
    if (difference) stockChanges.set(productId, difference);
  }

  const adjustments = [];
  let updateError = null;
  try {
    for (const [productId, difference] of stockChanges) {
      const filter = difference > 0
        ? { _id: productId, stock: { $gte: difference } }
        : { _id: productId };
      const result = await Product.updateOne(filter, { $inc: { stock: -difference } });
      if (!result.matchedCount) {
        updateError = 'stock';
        break;
      }
      adjustments.push({ productId, difference });
    }

    if (!updateError) {
      const total = updatedItems.reduce(
        (sum, item) => sum + item.quantity * item.unitPrice,
        0
      );
      const updatedOrder = await Order.findOneAndUpdate(
        { _id: order._id, updatedAt: order.updatedAt },
        { $set: { customerName, phone, address, items: updatedItems, total } },
        { new: true, runValidators: true }
      );
      if (!updatedOrder) updateError = 'changed';
    }
  } catch (error) {
    updateError = error;
  }

  if (updateError) {
    try {
      for (const { productId, difference } of adjustments.reverse()) {
        const result = await Product.updateOne(
          { _id: productId },
          { $inc: { stock: difference } }
        );
        if (!result.matchedCount) {
          throw new Error(`ไม่สามารถคืนสต็อกของเมนู ${productId} หลังแก้ไขคำสั่งซื้อไม่สำเร็จ`);
        }
      }
    } catch (rollbackError) {
      console.error('คืนสต็อกหลังแก้ไขคำสั่งซื้อไม่สำเร็จ:', rollbackError);
      return next(rollbackError);
    }

    if (updateError === 'stock') {
      return showError('สต็อกเมนูไม่เพียงพอสำหรับจำนวนที่ระบุ กรุณาปรับจำนวนอีกครั้ง', 409);
    }
    if (updateError === 'changed') {
      return showError('คำสั่งซื้อนี้ถูกแก้ไขจากหน้าจออื่นแล้ว กรุณาตรวจสอบและลองใหม่', 409);
    }
    return next(updateError);
  }

  res.redirect('/admin/orders');
});

module.exports = router;