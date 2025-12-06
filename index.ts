import { connectToDatabase } from "./db/connection.js";
import { app } from "./app.js";

connectToDatabase()
  .then(() => {
    const PORT = Number(process.env.MSSQL_PORT) || 1433;
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to start server due to database connection error:", err);
    process.exit(1);
  });
