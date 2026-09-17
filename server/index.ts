import { app } from "./app.ts";
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
app.listen(port, host, () =>
  console.info(`Pesan Agenda berjalan di http://${host}:${port}/pesan-agenda`),
);
