const express = require("express");
const multer = require("multer");
const path = require("path");
const mongoose = require("mongoose");
const { GridFSBucket } = require("mongodb");
const Handlebars = require("handlebars");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Connection

const mongoURI = process.env.MONGO_URI
  // "mongodb+srv://jls943754:zVkOvc1KkiG9ejvY@cluster0.xtgoy.mongodb.net/email-builder?retryWrites=true&w=majority";

// Initialize GridFS bucket reference
let gfsBucket;

mongoose
  .connect(mongoURI)
  .then(() => {
    console.log("Connected to MongoDB");
    gfsBucket = new GridFSBucket(mongoose.connection.db, {
      bucketName: "uploads",
    });
  })
  .catch((err) => console.error("MongoDB connection error:", err));

// Template Schema for MongoDB
const TemplateSchema = new mongoose.Schema({
  title: String,
  content: String,
  imageId: String, // Store GridFS file ID
  footer: String,
  html: String, // Store the HTML template
  createdAt: { type: Date, default: Date.now },
});

const Template = mongoose.model("Template", TemplateSchema);

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Store default email template in MongoDB
const defaultTemplate = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{title}}</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 0;
            background-color: #f4f4f4;
        }
        .container {
            max-width: 600px;
            margin: 20px auto;
            background: white;
            padding: 20px;
        }
        .header {
            text-align: center;
            padding: 20px;
            background: #f8f9fa;
        }
        .content {
            padding: 20px;
        }
        .image {
            max-width: 100%;
            height: auto;
            margin: 20px 0;
        }
        .footer {
            text-align: center;
            padding: 20px;
            background: #f8f9fa;
            font-size: 12px;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>{{title}}</h1>
        </div>
        <div class="content">
            {{{content}}}
            {{#if imageUrl}}
            <img src="{{imageUrl}}" alt="Email Image" class="image">
            {{/if}}
        </div>
        <div class="footer">
            {{{footer}}}
        </div>
    </div>
</body>
</html>
`;

// API Routes
app.get("/api/getEmailLayout", async (req, res) => {
  try {
    // Get the most recent template or return the default
    const template = await Template.findOne({ html: { $exists: true } }).sort({
      createdAt: -1,
    });

    res.send(template ? template.html : defaultTemplate);
  } catch (error) {
    console.error("Error fetching template:", error);
    res.status(500).send("Error reading template");
  }
});

app.post("/api/uploadImage", upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).send("No image uploaded");
  }

  try {
    // Create a unique filename
    const filename = `${Date.now()}-${req.file.originalname}`;

    // Create a GridFS stream
    const uploadStream = gfsBucket.openUploadStream(filename, {
      contentType: req.file.mimetype,
    });

    // Upload the file buffer to GridFS
    uploadStream.end(req.file.buffer);

    // Wait for the upload to complete
    await new Promise((resolve, reject) => {
      uploadStream.on("finish", resolve);
      uploadStream.on("error", reject);
    });

    // Return the file ID and filename
    res.json({
      imageId: uploadStream.id.toString(),
      imageUrl: `/api/images/${uploadStream.id}`,
    });
  } catch (error) {
    console.error("Error uploading image:", error);
    res.status(500).send("Error uploading image");
  }
});

// Serve images from GridFS
app.get("/api/images/:id", async (req, res) => {
  try {
    const file = await gfsBucket
      .find({ _id: new mongoose.Types.ObjectId(req.params.id) })
      .toArray();
    if (!file.length) {
      return res.status(404).send("Image not found");
    }

    res.set("Content-Type", file[0].contentType);
    const downloadStream = gfsBucket.openDownloadStream(
      new mongoose.Types.ObjectId(req.params.id)
    );
    downloadStream.pipe(res);
  } catch (error) {
    console.error("Error serving image:", error);
    res.status(500).send("Error serving image");
  }
});

app.post("/api/uploadEmailConfig", async (req, res) => {
  try {
    const template = new Template({
      ...req.body,
      html: defaultTemplate, // Store the HTML template
    });
    await template.save();
    res.json({ success: true, templateId: template._id });
  } catch (error) {
    console.error("Error saving template:", error);
    res.status(500).send("Error saving template");
  }
});

app.post("/api/renderAndDownloadTemplate", async (req, res) => {
  try {
    const template = await Template.findOne().sort({ createdAt: -1 });
    const compiledTemplate = Handlebars.compile(
      template ? template.html : defaultTemplate
    );
    const html = compiledTemplate(req.body);
    res.send(html);
  } catch (error) {
    console.error("Error rendering template:", error);
    res.status(500).send("Error rendering template");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
