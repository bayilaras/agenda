import { createInterface } from "node:readline";
import { hashPassword } from "./config.ts";

// Passwords arrive through stdin instead of command arguments / shell history.
if (process.stdin.isTTY) {
  process.stderr.write("Masukkan kata sandi (minimal 12 karakter): ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  let password = "";
  process.stdin.on("data", (chunk: string) => {
    if (chunk.includes("\u0003")) process.exit(130);
    for (const char of chunk) {
      if (char === "\r" || char === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stderr.write("\n");
        if (password.length < 12) {
          process.stderr.write("Gunakan minimal 12 karakter.\n");
          process.exitCode = 1;
        } else process.stdout.write(`${hashPassword(password)}\n`);
        return;
      }
      if (char === "\u007f" || char === "\b") password = password.slice(0, -1);
      else password += char;
    }
  });
} else {
  const reader = createInterface({ input: process.stdin });
  reader.once("line", (password) => {
    if (password.length < 12) {
      process.stderr.write("Gunakan minimal 12 karakter.\n");
      process.exitCode = 1;
    } else process.stdout.write(`${hashPassword(password)}\n`);
    reader.close();
  });
}
