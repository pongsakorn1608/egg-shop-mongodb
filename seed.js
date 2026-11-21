require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

async function createAdmin() {
  await mongoose.connect(process.env.MONGODB_URI);

  const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
  await User.updateOne(
    { email: process.env.ADMIN_EMAIL.toLowerCase() },
    { $set: { passwordHash, role: 'admin' } },
    { upsert: true }
  );

  console.log('สร้างบัญชี Admin ใน MongoDB เรียบร้อย (ไม่มีข้อมูลสินค้าในโค้ด)');
  await mongoose.disconnect();
}

createAdmin().catch(err => {
  console.error('เกิดข้อผิดพลาด:', err);
  process.exit(1);
});