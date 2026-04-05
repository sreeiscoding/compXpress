const fs = require("fs");
const path = require("path");

const USERS_FILE = path.join(__dirname, "users.json");

function ensureUsersFile() {
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, "[]", "utf8");
  }
}

function readUsers() {
  ensureUsersFile();
  const raw = fs.readFileSync(USERS_FILE, "utf8");
  const parsed = JSON.parse(raw || "[]");
  return Array.isArray(parsed) ? parsed : [];
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}

function findUserByEmail(email) {
  const users = readUsers();
  return users.find((u) => String(u.email).toLowerCase() === String(email).toLowerCase()) || null;
}

function createUser(user) {
  const users = readUsers();
  users.push(user);
  writeUsers(users);
  return user;
}

module.exports = {
  readUsers,
  writeUsers,
  findUserByEmail,
  createUser
};
