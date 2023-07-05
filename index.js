const express = require("express");
const multer = require("multer");
require("dotenv").config();
const { createWorker } = require("tesseract.js");
const sharp = require("sharp");
const path = require("path");
const app = express();
const upload = multer({ dest: "uploads/" });
const fs = require("fs");
const cors = require("cors");

const { MongoClient } = require("mongodb");
const uri = process.env.MONGO_URI;
const db = process.env.DB;
const db_collection_name = process.env.COLLECTION;
const client = new MongoClient(uri);
app.use(cors());

// Upload endpoint
app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const imagePath = req.file.path;
    const imageName = path.parse(imagePath).name;
    const convertedImagePath = path.join(
      path.parse(imagePath).dir,
      `${imageName}_converted.png`
    );

    // Convert the uploaded image to PNG format
    await sharp(imagePath).toFormat("png").toFile(convertedImagePath);

    // Initialize Tesseract worker
    const worker = await createWorker({
      logger: (m) => console.log("Logging worker", m.progress),
    });

    // Perform OCR on the converted image
    let extractedText;
    console.log("Extracted", extractedText);
    (async () => {
      await worker.loadLanguage("eng");
      await worker.initialize("eng");
      await worker.setParameters({
        tessedit_char_whitelist:
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
      });
      const { data } = await worker.recognize(convertedImagePath);
      extractedText = data?.text;
      await worker.terminate();

      // Extract name and roll number from the OCR result
      const nameStartIndex = extractedText.indexOf("Name") + 4;
      const nameEndIndex = extractedText.indexOf(" RollNumber");
      const name = extractedText
        .substring(nameStartIndex, nameEndIndex)
        .trim()
        .replace(/([a-z])([A-Z])/g, "$1 $2");

      const rollNumberStartIndex = extractedText.indexOf("RollNumber") + 10;
      const rollNumberEndIndex = extractedText.indexOf(
        "\n",
        rollNumberStartIndex
      );
      const rollNumber = extractedText
        .substring(rollNumberStartIndex, rollNumberEndIndex)
        .trim();

      // Extract subjects and marks from the OCR result
      const subjectsStartIndex = extractedText.indexOf("Subjects Marks") + 14;
      const subjectsEndIndex = extractedText.length;
      const subjectsMarksText = extractedText
        .substring(subjectsStartIndex, subjectsEndIndex)
        .trim();

      const subjectsMarksArray = subjectsMarksText.split("\n");
      const subjects = [];

      subjectsMarksArray.forEach((subjectMarks) => {
        const [subject, marks] = subjectMarks.split(" ");
        if (subject && marks) {
          const formattedSubject = subject.replace(/([a-z])([A-Z])/g, "$1 $2");
          subjects.push({ subject: formattedSubject, marks: parseInt(marks) });
        }
      });

      const result = {
        name,
        rollNumber,
        subjects,
      };
      // Delete the uploaded file and converted PNG file
      fs.unlinkSync(imagePath);
      fs.unlinkSync(convertedImagePath);
      console.log("Files deleted");
      await client.connect();
      const collection = client.db(db).collection(db_collection_name);

      // Check if the marksheet already exists in the database
      const existingMarkSheet = await collection.findOne({ rollNumber });
      if (existingMarkSheet) {
        console.log("Marksheet already exists in the database");
        res.status(409).json({ error: "Marksheet already exists" });
        return;
      }

      // Insert the marksheet into the database
      const insertResult = await collection.insertOne(result);
      console.log("Data inserted into MongoDB:", insertResult.insertedId);

      console.log(JSON.stringify(result, null, 2));
      res.json(result);
    })();
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to process the image" });
  }
});

// Get marksheet by roll number
app.get("/students/:rollNumber", async (req, res) => {
  try {
    const rollNumber = req.params.rollNumber;
    await client.connect();
    const collection = client.db(db).collection(db_collection_name);

    const result = await collection.findOne({ rollNumber });
    if (result) {
      res.json(result);
    } else {
      res.status(404).json({ error: "Record not found" });
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to retrieve the record" });
  }
});

const port = 8000;
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
