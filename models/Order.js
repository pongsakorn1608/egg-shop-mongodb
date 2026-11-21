const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  customerName: { type: String, required: true }, // ชื่อลูกค้า (ข้อมูลสมมติ)
  phone: { type: String, required: true },        // เบอร์โทรติดต่อ (ข้อมูลสมมติ)
  address: { type: String, default: 'รับที่ร้าน' }, // ที่อยู่จัดส่ง หรือรับที่ร้าน
  items: [{                                       // ฝังรายการอาหารที่สั่งไว้ในออเดอร์ (Embed)
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true }, // อ้างอิง ID สินค้า (Reference)
    name: String,
    quantity: Number,
    unitPrice: Number
  }],
  total: { type: Number, required: true },        // ยอดรวมสุทธิ
  status: { type: String, default: 'รอดำเนินการ' }
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);