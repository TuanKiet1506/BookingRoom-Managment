module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  res.status(200).json({
    ok: true,
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    hasServerSheetUrl: Boolean(process.env.GOOGLE_APPS_SCRIPT_URL),
  });
};
