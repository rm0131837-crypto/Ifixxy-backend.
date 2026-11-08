
import express from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is missing!");
  process.exit(1);
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// Security
app.use(helmet());

const allowedOrigins = (process.env.CORS_ORIGIN || "*")
  .split(",")
  .map(origin => origin.trim());

app.use(cors({
  origin: (origin, callback) => {
    if (
      !origin ||
      allowedOrigins.includes("*") ||
      allowedOrigins.includes(origin)
    ) {
      return callback(null, true);
    }
    callback(new Error("Origin not allowed"));
  }
}));

app.use(express.json({ limit: "1mb" }));

// API rate limit
app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false
}));

// Image upload
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (req, file, callback) => {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp"
    ];

    if (!allowed.includes(file.mimetype)) {
      return callback(
        new Error("Only JPG, PNG and WEBP images are allowed.")
      );
    }

    callback(null, true);
  }
});

// AI Instructions
const SYSTEM_PROMPT = `
You are iFixxy AI, a helpful technology support assistant.

Your responsibilities:
1. Help users understand hardware problems.
2. Help users troubleshoot software problems.
3. Analyze uploaded device images.
4. Give clear step-by-step explanations.
5. Support the language requested by the user.
6. Ask follow-up questions when information is missing.

Important safety rules:
- Never tell users to touch live electrical wiring.
- Never instruct users to open power supplies or dangerous devices.
- Do not recommend unsafe battery repairs.
- Recommend a qualified technician for hazardous repairs.
- Never claim certainty when the evidence is insufficient.
- Do not invent device specifications.

Response style:
- Use simple language.
- Organize answers with headings.
- Explain the likely cause.
- Give safe checks first.
- Explain when professional repair is needed.

You are iFixxy, not a generic chatbot.
`;

// Gemini request helper
async function askGemini(input, previousId = undefined) {
  const request = {
    model: MODEL,
    input,
    store: true
  };

  if (previousId) {
    request.previous_interaction_id = previousId;
  }

  const result = await ai.interactions.create(request);

  return {
    reply: result.output_text || "No response generated.",
    interactionId: result.id
  };
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    app: "iFixxy",
    status: "online",
    ai: "Gemini",
    model: MODEL,
    timestamp: new Date().toISOString()
  });
});

// AI Chat
app.post("/api/chat", async (req, res) => {
  try {
    const {
      message,
      language = "English",
      previousInteractionId
    } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        success: false,
        error: "Please provide a message."
      });
    }

    if (message.length > 10000) {
      return res.status(400).json({
        success: false,
        error: "Message is too long."
      });
    }

    const input = [
      {
        type: "text",
        text: `${SYSTEM_PROMPT}

Respond in ${language}.

User message:
${message}`
      }
    ];

    const result = await askGemini(
      input,
      previousInteractionId
    );

    res.json({
      success: true,
      reply: result.reply,
      interactionId: result.interactionId
    });

  } catch (error) {
    console.error("Chat error:", error.message);

    res.status(500).json({
      success: false,
      error: "AI chat failed. Please try again."
    });
  }
});

// Hardware / Software Diagnosis
app.post(
  "/api/diagnose",
  upload.single("image"),
  async (req, res) => {
    try {
      const {
        device = "Unknown device",
        problem,
        language = "English"
      } = req.body;

      if (!problem || typeof problem !== "string") {
        return res.status(400).json({
          success: false,
          error: "Please describe the problem."
        });
      }

      if (problem.length > 10000) {
        return res.status(400).json({
          success: false,
          error: "Problem description is too long."
        });
      }

      const prompt = `
${SYSTEM_PROMPT}

Perform a technology diagnosis.

Device: ${device}
Problem: ${problem}
Response language: ${language}

Give your response in this format:

1. Possible Cause
2. Safe Initial Checks
3. Step-by-Step Solution
4. Tools or Professional Help Needed
5. Safety Warning (if necessary)
6. Final Recommendation

If the available information is insufficient,
ask the user for more details.
`;

      const input = [];

      // Add image if uploaded
      if (req.file) {
        input.push({
          type: "image",
          mime_type: req.file.mimetype,
          data: req.file.buffer.toString("base64")
        });
      }

      input.push({
        type: "text",
        text: prompt
      });

      const result = await askGemini(input);

      res.json({
        success: true,
        diagnosis: result.reply,
        interactionId: result.interactionId,
        imageAnalyzed: Boolean(req.file)
      });

    } catch (error) {
      console.error("Diagnosis error:", error.message);

      res.status(500).json({
        success: false,
        error: "Diagnosis failed. Please try again."
      });
    }
  }
);

// 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "API route not found."
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error("Server error:", error.message);

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      error: "Image upload failed or file is too large."
    });
  }

  res.status(500).json({
    success: false,
    error: "Internal server error."
  });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log("--------------------------------");
  console.log("iFixxy Backend is running!");
  console.log("Port:", PORT);
  console.log("AI:", MODEL);
  console.log("--------------------------------");
});
      
