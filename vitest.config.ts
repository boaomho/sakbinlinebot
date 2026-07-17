import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Regression harness (บรีฟ v1.5 Step 9) — replay บทสนทนาเข้า handler จริง
 * env มาจาก .env.test (DATABASE_URL ชี้ Neon branch harness-test เท่านั้น)
 * loadEnv(..., "") = ไม่กรอง prefix → ได้ทุกตัวรวม DATABASE_URL
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    env: loadEnv("test", process.cwd(), ""),
    setupFiles: ["./tests/harness/setup.ts"],
    // scenario ทุกบทใช้ DB harness-test ก้อนเดียวกัน + truncate ต่อบท → ห้ามรันขนาน
    fileParallelism: false,
    sequence: { concurrent: false },
    // DB จริงข้ามเน็ต + debounce → เผื่อเวลา
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["tests/scenarios/**/*.test.ts"],
  },
});
