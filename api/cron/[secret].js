const remindersHandler = require("./reminders");

module.exports = async function handler(req, res) {
  return remindersHandler(req, res);
};
