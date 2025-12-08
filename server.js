const express = require("express");
const app = express();

// Your middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Example route
app.get("/", (req, res) => {
  res.send("Khadija Jewellery API Working on Vercel!");
});

// Export app for Vercel (NO app.listen)
module.exports = app;
