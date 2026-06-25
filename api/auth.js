const { ADMIN_EMAIL, createSessionToken } = require("./_auth");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const { credential } = req.body || {};
    if (!credential) {
      res.status(400).json({ ok: false, error: "Missing Google credential" });
      return;
    }

    const clientId = process.env.GOOGLE_CLIENT_ID || "";
    if (!clientId) {
      res.status(500).json({ ok: false, error: "Missing GOOGLE_CLIENT_ID" });
      return;
    }

    const params = new URLSearchParams({ id_token: credential });
    const googleResponse = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?${params.toString()}`,
    );
    const profile = await googleResponse.json().catch(() => ({}));

    if (!googleResponse.ok) {
      res.status(401).json({ ok: false, error: "Invalid Google credential" });
      return;
    }

    const email = String(profile.email || "").toLowerCase();
    const emailVerified = String(profile.email_verified) === "true";
    if (profile.aud !== clientId || !emailVerified || email !== ADMIN_EMAIL) {
      res.status(403).json({
        ok: false,
        error: "Chỉ tài khoản admin@khomes.com.vn được phép truy cập.",
      });
      return;
    }

    res.status(200).json({
      ok: true,
      email,
      token: createSessionToken(email),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error.message || error) });
  }
};
