require("dotenv").config();
console.log("🔥 SERVER STARTING...");

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// =======================
// SOCKET.IO
// =======================
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
    ],
    credentials: true,
  },
});

// =======================
// MIDDLEWARE
// =======================
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
    ],
    credentials: true,
  })
);

app.use(express.json());

// request logger
app.use((req, res, next) => {
  console.log("➡️", req.method, req.url);
  next();
});

// =======================
// TEST ROUTE
// =======================
app.get("/", (req, res) => {
  res.send("Backend running 🚀");
});

// =======================
// DB CONNECTION
// =======================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected ✅"))
  .catch((err) =>
    console.log("DB ERROR:", err.message)
  );

// =======================
// USER MODEL
// =======================
const userSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  password: String,
  role: String,
  resetToken: String,
  resetTokenExpire: Date,
});

const User =
  mongoose.models.User ||
  mongoose.model("User", userSchema);

// =======================
// PATIENT MODEL
// =======================
const patientSchema = new mongoose.Schema(
  {
    name: String,
    age: Number,
    gender: String,
    phone: String,
    visits: {
      type: Array,
      default: [],
    },
  },
  { timestamps: true }
);

const Patient =
  mongoose.models.Patient ||
  mongoose.model(
    "Patient",
    patientSchema
  );

// =======================
// MESSAGE MODEL
// =======================
const messageSchema =
  new mongoose.Schema(
    {
      senderId: String,
      receiverId: String,
      senderRole: String,
      receiverRole: String,
      text: String,
      seen: {
        type: Boolean,
        default: false,
      },
    },
    { timestamps: true }
  );

const Message =
  mongoose.models.Message ||
  mongoose.model(
    "Message",
    messageSchema
  );

// =======================
// SOCKET EVENTS
// =======================
io.on("connection", (socket) => {
  console.log(
    "🟢 User Connected:",
    socket.id
  );

  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);
    console.log("Joined:", roomId);
  });

  socket.on(
    "sendMessage",
    async (data) => {
      try {
        const {
          senderId,
          receiverId,
          senderRole,
          receiverRole,
          text,
          roomId,
        } = data;

        const newMessage =
          await Message.create({
            senderId,
            receiverId,
            senderRole,
            receiverRole,
            text,
          });

        io.to(roomId).emit(
          "receiveMessage",
          newMessage
        );
      } catch (err) {
        console.log(
          "SOCKET MESSAGE ERROR:",
          err
        );
      }
    }
  );

  socket.on(
    "markSeen",
    async ({ senderId, receiverId }) => {
      await Message.updateMany(
        {
          senderId,
          receiverId,
          seen: false,
        },
        {
          seen: true,
        }
      );
    }
  );

  socket.on("disconnect", () => {
    console.log("🔴 Disconnected");
  });
});

// =======================
// REGISTER
// =======================
app.post(
  "/api/auth/register",
  async (req, res) => {
    try {
      const {
        email,
        password,
        role,
      } = req.body;

      if (
        !email ||
        !password ||
        !role
      ) {
        return res.status(400).json({
          message:
            "All fields required",
        });
      }

      const exists =
        await User.findOne({
          email,
        });

      if (exists) {
        return res.status(400).json({
          message:
            "User already exists",
        });
      }

      const hashedPassword =
        await bcrypt.hash(
          password,
          10
        );

      await User.create({
        email,
        password:
          hashedPassword,
        role,
      });

      res.json({
        message:
          "User registered successfully",
      });
    } catch (err) {
      console.log(
        "REGISTER ERROR:",
        err
      );
      res.status(500).json({
        message:
          "Server error",
      });
    }
  }
);

// =======================
// LOGIN
// =======================
app.post(
  "/api/auth/login",
  async (req, res) => {
    try {
      const {
        email,
        password,
      } = req.body;

      const user =
        await User.findOne({
          email,
        });

      if (!user) {
        return res.status(404).json({
          message:
            "User does not exist",
        });
      }

      const isMatch =
        await bcrypt.compare(
          password,
          user.password
        );

      if (!isMatch) {
        return res.status(401).json({
          message:
            "Invalid credentials",
        });
      }

      res.json({
        message:
          "Login successful",
        role: user.role,
        userId: user._id,
        email: user.email,
      });
    } catch (err) {
      console.log(
        "LOGIN ERROR:",
        err
      );
      res.status(500).json({
        message:
          "Server error",
      });
    }
  }
);

// =======================
// FORGOT PASSWORD
// =======================
app.post(
  "/api/auth/forgot-password",
  async (req, res) => {
    try {
      const { email } =
        req.body;

      if (!email) {
        return res.status(400).json({
          message:
            "Email required",
        });
      }

      const user =
        await User.findOne({
          email,
        });

      if (!user) {
        return res.status(404).json({
          message:
            "User not found",
        });
      }

      const token =
        crypto
          .randomBytes(32)
          .toString("hex");

      user.resetToken =
        token;

      user.resetTokenExpire =
        Date.now() +
        15 *
          60 *
          1000;

      await user.save();

      const transporter =
        nodemailer.createTransport(
          {
            service:
              "gmail",
            auth: {
              user: process.env
                .EMAIL,
              pass: process.env
                .EMAIL_PASS,
            },
          }
        );

      const resetLink = `http://localhost:5173/reset-password/${token}`;

      await transporter.sendMail(
        {
          from: process.env
            .EMAIL,
          to: email,
          subject:
            "Password Reset Request",
          html: `
          <h2>Password Reset</h2>
          <a href="${resetLink}">${resetLink}</a>
        `,
        }
      );

      res.json({
        message:
          "Reset link sent successfully",
      });
    } catch (err) {
      res.status(500).json({
        message:
          "Failed to send email",
      });
    }
  }
);

// =======================
// RESET PASSWORD
// =======================
app.post(
  "/api/auth/reset-password/:token",
  async (req, res) => {
    try {
      const { token } =
        req.params;

      const { password } =
        req.body;

      const user =
        await User.findOne({
          resetToken:
            token,
          resetTokenExpire:
            {
              $gt:
                Date.now(),
            },
        });

      if (!user) {
        return res.status(400).json({
          message:
            "Invalid token",
        });
      }

      const hashedPassword =
        await bcrypt.hash(
          password,
          10
        );

      user.password =
        hashedPassword;

      user.resetToken =
        undefined;

      user.resetTokenExpire =
        undefined;

      await user.save();

      res.json({
        message:
          "Password reset successful",
      });
    } catch (err) {
      res.status(500).json({
        message:
          "Server error",
      });
    }
  }
);

// =======================
// GET ALL PATIENTS
// =======================
app.get(
  "/api/patients",
  async (req, res) => {
    try {
      const patients =
        await Patient.find().sort(
          {
            createdAt: -1,
          }
        );

      res.json(patients);
    } catch (err) {
      res.status(500).json({
        message:
          "Server error",
      });
    }
  }
);

// =======================
// ADD PATIENT
// =======================
app.post(
  "/api/patients",
  async (req, res) => {
    try {
      const {
        name,
        age,
        gender,
        phone,
      } = req.body;

      const patient =
        await Patient.create({
          name,
          age,
          gender,
          phone,
        });

      res.status(201).json(
        patient
      );
    } catch (err) {
      res.status(500).json({
        message:
          "Server error",
      });
    }
  }
);

// =======================
// ADD VISIT
// =======================
app.put(
  "/api/patients/:id/visit",
  async (req, res) => {
    try {
      const updatedPatient =
        await Patient.findByIdAndUpdate(
          req.params.id,
          {
            $push: {
              visits: {
                $each: [
                  req.body,
                ],
                $position: 0,
              },
            },
          },
          { new: true }
        );

      res.json(
        updatedPatient
      );
    } catch (err) {
      res.status(500).json({
        message:
          "Server error",
      });
    }
  }
);

// =======================
// GET CHAT HISTORY
// =======================
app.get(
  "/api/messages/:a/:b",
  async (req, res) => {
    try {
      const { a, b } =
        req.params;

      const messages =
        await Message.find({
          $or: [
            {
              senderId: a,
              receiverId: b,
            },
            {
              senderId: b,
              receiverId: a,
            },
          ],
        }).sort({
          createdAt: 1,
        });

      res.json(messages);
    } catch (err) {
      res.status(500).json({
        message:
          "Server error",
      });
    }
  }
);

// =======================
// START SERVER
// =======================
server.listen(5000, () => {
  console.log(
    "Server running on http://localhost:5000"
  );
});