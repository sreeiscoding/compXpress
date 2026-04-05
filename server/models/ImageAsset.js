const mongoose = require("mongoose");

const imageAssetSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    type: {
      type: String,
      enum: ["compressed", "passport"],
      required: true,
      index: true
    },
    originalName: {
      type: String,
      default: "image"
    },
    mimeType: {
      type: String,
      required: true
    },
    size: {
      type: Number,
      required: true
    },
    format: {
      type: String,
      enum: ["png", "jpg", "jpeg", "webp", "unknown"],
      default: "unknown"
    },
    sourceType: {
      type: String,
      enum: ["original", "compressed", ""],
      default: ""
    },
    bgColor: {
      type: String,
      enum: ["white", "blue", ""],
      default: ""
    },
    originalSize: {
      type: Number,
      default: 0
    },
    data: {
      type: Buffer,
      required: true
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model("ImageAsset", imageAssetSchema);
