import {
  createDirectus,
  rest,
  staticToken,
  authentication,
  login,
  createItem,
} from "@directus/sdk";

// 1. Cấu hình directus client
const directus = createDirectus("http://localhost:8055")
  .with(rest())
  .with(authentication());

// 2. Hàm random dữ liệu đơn giản
function randomRoom(i) {
  return {
    title: `Phòng trọ số ${i}`,
    description: `Phòng trọ số ${i} rộng rãi, thoáng mát, giá hợp lý.`,
    number_room: `${100 + i}`,
    floor: Math.floor(Math.random() * 5) + 1,
    room_price: 1500000 + Math.floor(Math.random() * 5000000),
    acreage: 15 + Math.floor(Math.random() * 25),
    deposit: 1000000 + Math.floor(Math.random() * 2000000),
    limit_people: Math.floor(Math.random() * 4) + 1,
    rental_object: "all",
    building: 1, // gắn tạm vào building id = 1 (sửa tùy DB bạn)
    room_type: 5, // gắn tạm vào room_type id = 5
  };
}

async function main() {
  try {
    // 3. Login bằng admin account
    await directus.login({
      email: "admin@example.com",
      password: "yourpassword",
    });

    // 4. Tạo 50 room
    for (let i = 1; i <= 50; i++) {
      const room = randomRoom(i);
      await directus.request(createItem("room", room));
      console.log(`✅ Created room ${i}`);
    }

    console.log("🎉 Done seeding 50 rooms");
  } catch (err) {
    console.error("❌ Error seeding rooms:", err);
  }
}

main();
