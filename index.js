// ==== DEPENDENCIES ====
const { Telegraf } = require("telegraf");
const moment = require("moment-timezone");
const chalk = require("chalk");
const fs = require("fs");
const axios = require("axios");
const os = require("os");
const mongoose = require("mongoose");
let boxen;
import("boxen").then((module) => {
  boxen = module.default;
});
require("dotenv").config();

// ==== KONEKSI AZURE COSMOSDB (MONGODB) ====
// Ganti <password> dengan password database kamu!
const mongoUri = 'mongodb://daysdb:Kasihibu8@daysmongodb.mongo.cosmos.azure.com:10255/?ssl=true&replicaSet=globaldb&retrywrites=false';
mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB Azure Connected!'))
  .catch(console.error);

// ==== SCHEMA MONGOOSE ====
const produkSchema = new mongoose.Schema({
  name: String,
  price: Number,
  stock: Number,
  desc: String,
  category: String,
  snk: String,
  expired_at: Date,
});
const Produk = mongoose.model('Produk', produkSchema);

const orderSchema = new mongoose.Schema({
  user_id: Number,
  produk_id: mongoose.Schema.Types.ObjectId,
  qty: Number,
  status: String,
  created_at: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);

const cartSchema = new mongoose.Schema({
  user_id: Number,
  items: [
    {
      produk_id: mongoose.Schema.Types.ObjectId,
      qty: Number
    }
  ],
  updated_at: { type: Date, default: Date.now }
});
const Cart = mongoose.model('Cart', cartSchema);

// ==== INISIALISASI BOT ====
const bot = new Telegraf(process.env.BOT_TOKEN);
console.log("[BOT] Telegram bot is running...");

// ==== ADMIN ID ====
const adminIds = [5703446444]; // Ganti dengan Telegram user id kamu

// ==== ADDPRODUK ====
bot.command("addproduk", async (ctx) => {
  if (!adminIds.includes(ctx.from.id)) {
    return ctx.reply("❌ Hanya admin yang bisa menambah produk!");
  }
  const text = ctx.message.text.split(" ").slice(1).join(" ");
  const [name, price, stock, desc, category, snk, expired_at] = text
    .split("|")
    .map((t) => t?.trim());
  if (!name || !price || !stock) {
    return ctx.reply("❗ Format salah!\n/addproduk nama|harga|stock|deskripsi|kategori|snk|expired_at");
  }
  try {
    const newProduk = new Produk({ name, price: Number(price), stock: Number(stock), desc, category, snk, expired_at: expired_at ? new Date(expired_at) : null });
    await newProduk.save();
    ctx.reply(`✅ Produk baru ditambahkan!\nNama: ${name}\nHarga: ${price}\nStok: ${stock}`);
  } catch (err) {
    ctx.reply("❌ Error: " + err.message);
  }
});

// ==== LISTPRODUK ====
bot.command("listproduk", async (ctx) => {
  const produkList = await Produk.find().limit(50);
  if (produkList.length === 0) return ctx.reply("Belum ada produk.");
  let msg = "*List Produk:*\n";
  produkList.forEach((p, i) => {
    msg += `${i + 1}. ${p.name} | Rp${p.price} | Stok: ${p.stock}\n`;
  });
  ctx.replyWithMarkdown(msg);
});

// ==== ADD TO CART ====
bot.command("addcart", async (ctx) => {
  const [cmd, produkId, qty] = ctx.message.text.split(" ");
  if (!produkId || !qty) return ctx.reply("Format: /addcart <produkId> <qty>");
  const userId = ctx.from.id;
  const produk = await Produk.findById(produkId);
  if (!produk) return ctx.reply("Produk tidak ditemukan!");
  let cart = await Cart.findOne({ user_id: userId });
  if (!cart) cart = new Cart({ user_id: userId, items: [] });
  const idx = cart.items.findIndex(x => x.produk_id.equals(produk._id));
  if (idx === -1) {
    cart.items.push({ produk_id: produk._id, qty: Number(qty) });
  } else {
    cart.items[idx].qty += Number(qty);
  }
  await cart.save();
  ctx.reply(`✅ Ditambah ke keranjang: ${produk.name} (${qty}x)\nLihat keranjang: /cart`);
});

// ==== LIHAT CART ====
bot.command("cart", async (ctx) => {
  const userId = ctx.from.id;
  const cart = await Cart.findOne({ user_id: userId }).populate('items.produk_id');
  if (!cart || cart.items.length === 0) return ctx.reply("Keranjang kosong.");
  let msg = "*Keranjang Belanja:*\n";
  cart.items.forEach((item, i) => {
    msg += `${i + 1}. ${item.produk_id.name} (${item.qty}x)\n`;
  });
  ctx.replyWithMarkdown(msg);
});

// ==== CHECKOUT ====
bot.command("checkout", async (ctx) => {
  const userId = ctx.from.id;
  const cart = await Cart.findOne({ user_id: userId });
  if (!cart || cart.items.length === 0) return ctx.reply("Keranjang kosong.");
  for (const item of cart.items) {
    const order = new Order({
      user_id: userId,
      produk_id: item.produk_id,
      qty: item.qty,
      status: 'pending'
    });
    await order.save();
    // update stock produk
    await Produk.findByIdAndUpdate(item.produk_id, { $inc: { stock: -item.qty } });
  }
  await Cart.deleteOne({ user_id: userId });
  ctx.reply("✅ Order sudah dibuat, silakan lakukan pembayaran.");
});

// ==== DAFTAR COMMAND MENU ====
const commands = [
  { command: "start", description: "Start the bot" },
  { command: "addproduk", description: "Tambah produk baru" },
  { command: "listproduk", description: "Lihat list produk" },
  { command: "addcart", description: "Tambah ke keranjang (/addcart <produkId> <qty>)" },
  { command: "cart", description: "Lihat keranjang" },
  { command: "checkout", description: "Checkout pesanan" },
];
bot.telegram.setMyCommands(commands);

// ==== LOGGING ====
const getRandomColor = () => {
  const colors = [
    chalk.red,
    chalk.green,
    chalk.yellow,
    chalk.blue,
    chalk.magenta,
    chalk.cyan,
    chalk.white,
  ];
  return colors[Math.floor(Math.random() * colors.length)];
};
bot.use((ctx, next) => {
  const timestamp = moment().format("YYYY-MM-DD");
  const time = moment().format("HH:mm:ss");
  const username = ctx.from.username || ctx.from.id;
  const message = ctx.message?.text || "[Non-text message]";
  const coloredMessage = getRandomColor()(message);
  const logMessage = `[LOG] ${chalk.yellow(timestamp)} ${chalk.green(
    time
  )} | ${chalk.cyan(username)} | ${coloredMessage}`;
  console.log(
    boxen(logMessage, {
      padding: 0,
      margin: 0,
      borderStyle: "round",
      borderColor: "blue",
      dimBorder: true,
    })
  );
  return next();
});

// ==== BOT STARTUP ====
bot.launch().then(() => {
  console.log("[BOT] Bot Telegram siap menerima perintah.");
});
bot.catch((err) => {
  console.error("[ERROR] Terjadi kesalahan:", err);
});
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
