import { createApp } from "./app";

const app = createApp();

app.listen(8080, () => {
  console.log("Server running on http://localhost:8080");
});

export default app;
