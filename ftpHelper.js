// ftpHelper.js
import ftp from "basic-ftp";
import fs from "fs";

const FTP_CONFIG = {
  host: "192.185.129.252",
  port: 21,
  user: "vr@silverhouse.business",
  password: "avETbx54=w5(",
  secure: false,
};

export default class FTPHelper {
  static async connect() {
    const client = new ftp.Client();
    client.ftp.verbose = false;
    await client.access(FTP_CONFIG);
    return client;
  }

  // Read remote file -> return string (uses a temporary local file)
  static async readFile(remotePath) {
    const client = await FTPHelper.connect();
    const tmp = `./.tmp_ftp_read_${Date.now()}.tmp`;
    try {
      await client.downloadTo(tmp, remotePath);
      const content = fs.readFileSync(tmp, "utf8");
      fs.unlinkSync(tmp);
      return content;
    } catch (err) {
      // return null if not found or error
      // console.log("FTP readFile error", err.message);
      return null;
    } finally {
      client.close();
    }
  }

  // Write string content to remotePath (uses temp file), overwrites remote
  static async writeFile(remotePath, content) {
    const client = await FTPHelper.connect();
    const tmp = `./.tmp_ftp_write_${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tmp, content, "utf8");
      const dir = remotePath.split("/").slice(0, -1).join("/") || "/";
      if (dir) await client.ensureDir(dir);
      await client.uploadFrom(tmp, remotePath);
      fs.unlinkSync(tmp);
      return true;
    } catch (err) {
      console.error("FTP writeFile error:", err.message || err);
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
      return false;
    } finally {
      client.close();
    }
  }

  // List directory for debugging
  static async list(remoteDir = "/") {
    const client = await FTPHelper.connect();
    try {
      const list = await client.list(remoteDir);
      return list;
    } catch (err) {
      return null;
    } finally {
      client.close();
    }
  }
}
