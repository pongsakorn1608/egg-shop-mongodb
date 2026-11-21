require('dotenv').config();
const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const path = require('path');

const shopRoutes = require('./routes/shop');
const adminRoutes = require('./routes/admin');

const app = express();

// ตั้งค่า Template Engine เป็น EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// รับข้อมูลจากฟอร์ม (req.body) และตั้งค่า Session
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'egg-shop-secret',
  resave: false,
  saveUninitialized: false
}));

// ส่งค่าจำนวนสินค้าในตะกร้าและสถานะ Admin ไปใช้ในทุกหน้า (header.ejs)
app.use((req, res, next) => {
  res.locals.isAdmin = req.session.isAdmin === true;
  res.locals.cartCount = Object.values(req.session.cart || {}).reduce((a, b) => a + b, 0);
  next();
});

// เชื่อมโยง Routes
app.use('/', shopRoutes);
app.use('/admin', adminRoutes);

// จัดการหน้า 404 และ Error
app.use((req, res) => res.status(404).send('ไม่พบหน้าที่ต้องการ (404)'));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('เกิดข้อผิดพลาดในระบบ กรุณาตรวจสอบ Terminal');
});

// เชื่อมต่อ MongoDB และเปิดเซิร์ฟเวอร์
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('เชื่อมต่อ MongoDB สำเร็จ!');
    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log(`เปิดเว็บได้ที่ http://localhost:${port}`));
  })
  .catch(err => {
    console.error('เชื่อมต่อ MongoDB ไม่สำเร็จ:', err.message);
  });