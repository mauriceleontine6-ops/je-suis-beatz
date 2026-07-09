/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import {setGlobalOptions} from "firebase-functions";
import {onRequest} from "firebase-functions/v2/https";
import axios from "axios";

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

/**
 * audioProxy — Proxie les fichiers audio de Firebase Storage avec CORS headers
 * Utilisation: GET /audioProxy?u=<encoded_url>
 * 
 * Cela résout les problèmes CORS lors de la lecture des fichiers audio
 * stockés dans Firebase Storage depuis le navigateur.
 */
export const audioProxy = onRequest(async (req, res) => {
  // Configuration CORS
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Range");
  res.header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");

  // Répondre aux requêtes OPTIONS (preflight)
  if (req.method === "OPTIONS") {
    res.status(200).send("");
    return;
  }

  try {
    // Récupérer l'URL du paramètre query
    const encodedUrl = req.query.u as string;
    if (!encodedUrl) {
      res.status(400).json({error: "Missing parameter: u (encoded URL)"});
      return;
    }

    let targetUrl: string;
    try {
      targetUrl = decodeURIComponent(encodedUrl);
    } catch (e) {
      res.status(400).json({error: "Invalid URL encoding"});
      return;
    }

    // Validation de sécurité — autoriser uniquement Firebase Storage
    if (!targetUrl.includes("firebasestorage.googleapis.com") &&
        !targetUrl.includes("storage.googleapis.com")) {
      res.status(403).json({error: "Forbidden — only Firebase Storage URLs allowed"});
      return;
    }

    // Récupérer le fichier
    const response = await axios.get(targetUrl, {
      responseType: "stream",
      timeout: 30000,
      headers: {
        "User-Agent": "Je-Suis-Beatz-AudioProxy/1.0"
      }
    });

    // Transférer les headers pertinents
    const contentType = String(response.headers["content-type"] || "audio/mpeg");
    res.header("Content-Type", contentType);
    res.header("Accept-Ranges", "bytes");
    
    if (response.headers["content-length"]) {
      res.header("Content-Length", String(response.headers["content-length"]));
    }

    // Streamer le fichier
    response.data.pipe(res);
  } catch (error: unknown) {
    console.error("audioProxy error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({error: `Proxy error: ${errorMessage}`});
  }
});
