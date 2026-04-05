const axios = require("axios");
const FormData = require("form-data");

async function removeBackgroundBuffer({ buffer, filename, mimeType }) {
  if (!process.env.REMOVE_BG_API_KEY) {
    throw new Error("REMOVE_BG_API_KEY is not configured.");
  }

  const form = new FormData();
  form.append("image_file", buffer, {
    filename: filename || "upload.png",
    contentType: mimeType || "image/png"
  });
  form.append("size", "auto");

  let response;
  try {
    response = await axios.post("https://api.remove.bg/v1.0/removebg", form, {
      headers: {
        ...form.getHeaders(),
        "X-Api-Key": process.env.REMOVE_BG_API_KEY
      },
      responseType: "arraybuffer",
      timeout: 60000,
      validateStatus: () => true
    });
  } catch (requestError) {
    const error = new Error(`remove.bg network failure (${requestError.code || "UNKNOWN"}): ${requestError.message}`);
    error.status = 502;
    throw error;
  }

  if (response.status < 200 || response.status >= 300) {
    const message = Buffer.from(response.data || "").toString("utf8") || "remove.bg request failed";
    const error = new Error(`remove.bg upstream error (${response.status}): ${message}`);
    error.status = response.status;
    throw error;
  }

  return Buffer.from(response.data);
}

module.exports = {
  removeBackgroundBuffer
};
