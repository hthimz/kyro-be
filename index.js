const express = require("express");
const multer = require("multer");
const { createWorker } = require("tesseract.js");
const sharp = require("sharp");
const path = require("path");
const app = express();
const upload = multer({ dest: "uploads/" });
const fs = require("fs");
const cors = require("cors");

const { MongoClient } = require("mongodb");
const uri =
  "mongodb+srv://hthimz:rootuser@namastecluster.dbnxz77.mongodb.net/?retryWrites=true&w=majority";
const client = new MongoClient(uri);
app.use(cors());

app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const imagePath = req.file.path;
    const imageName = path.parse(imagePath).name;
    const convertedImagePath = path.join(
      path.parse(imagePath).dir,
      `${imageName}_converted.png`
    );

    await sharp(imagePath).toFormat("png").toFile(convertedImagePath);

    const worker = await createWorker({
      logger: (m) => console.log("Loggin worker", m.progress),
    });
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

      // Extract subjects and marks
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

      await client.connect();
      const collection = client.db("kyro").collection("marksheet");
      const insertResult = await collection.insertOne(result);
      console.log("Data inserted into MongoDB:", insertResult.insertedId);

      // Delete the uploaded file and converted PNG file
      fs.unlinkSync(imagePath);
      fs.unlinkSync(convertedImagePath);
      console.log("Files deleted");

      console.log(JSON.stringify(result, null, 2));
      res.json(result);
    })();
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to process the image" });
  }
});

app.get("/students/:rollNumber", async (req, res) => {
  try {
    const rollNumber = req.params.rollNumber;
    await client.connect();
    const collection = client.db("kyro").collection("marksheet");

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

const createRollNumberIndex = async () => {
  try {
    await client.connect();
    const collection = client.db("kyro").collection("marksheet");

    const indexKey = { rollNumber: 1 }; // Create an index on the rollNumber field in ascending order
    const options = { unique: true }; // Set the unique option to true if you want rollNumber values to be unique

    await collection.createIndex(indexKey, options);
    console.log("Index created successfully");
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await client.close();
  }
};

// createRollNumberIndex(); // called to create Indexes based on rollNumber

const port = 8000;
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
