import { app } from '@azure/functions';
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import https from 'https';
import http from 'http';

const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
const apiKey = process.env.AZURE_OPENAI_KEY;
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
const speechKey = process.env.AZURE_SPEECH_KEY;
const speechRegion = process.env.AZURE_SPEECH_REGION;

// Función helper para hacer fetch con https nativo
function fetchWithNativeHttp(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };
    
    const req = protocol.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, status: res.statusCode, text: () => Promise.resolve(data) });
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.end();
  });
}

app.http('read', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    // Manejar preflight CORS request
    if (request.method === 'OPTIONS') {
      return {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      };
    }

    try {
      const body = await request.json();
      let url = body?.url;
      
      context.log('URL recibida:', url);
      
      if (!url || typeof url !== 'string') {
        return { 
          status: 400, 
          headers: { 
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json"
          },
          jsonBody: { error: "Se requiere una URL válida en el body" }
        };
      }

      // Limpiar la URL
      url = url.trim();
      
      // Asegurar que la URL tenga protocolo
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      
      context.log('URL procesada:', url);
      context.log('Longitud URL:', url.length);
      context.log('Primeros 100 caracteres:', url.substring(0, 100));
      
      // Validar que la URL sea válida
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
        context.log('URL parseada exitosamente');
        context.log('Protocol:', parsedUrl.protocol);
        context.log('Host:', parsedUrl.host);
      } catch (urlError) {
        context.error('Error al parsear URL:', urlError.message);
        return { 
          status: 400, 
          headers: { 
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json"
          },
          jsonBody: { error: `URL inválida: ${urlError.message}` }
        };
      }

      context.log('Intentando fetch con https nativo...');
      let resp;
      try {
        resp = await fetchWithNativeHttp(parsedUrl.href);
        context.log('Fetch exitoso, status:', resp.status);
      } catch (fetchError) {
        context.error('Error en fetch:', fetchError.message);
        throw new Error(`Error al conectar: ${fetchError.message}`);
      }
      
      if (!resp.ok) throw new Error(`Error al descargar: ${resp.status}`);
      const html = await resp.text();

      const $ = cheerio.load(html);
      let text = $("body").text();
      text = text.replace(/\s+/g, " ").trim();

      const chunk = text.slice(0, 7000);

      const aiResp = await fetch(
        `${endpoint}openai/deployments/${deployment}/chat/completions?api-version=2024-02-01`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-key": apiKey
          },
          body: JSON.stringify({
            messages: [
              { role: "system", content: "Eres un asistente experto en generar resúmenes claros y completos del contenido visible de una página web. no usas markdown" },
              { role: "user", content: `Por favor, haz un resumen comprensivo de este contenido:\n\n${chunk}` }
            ],
            max_tokens: 800,
            temperature: 0.5
          })
        }
      );

      const aiData = await aiResp.json();
      const summary = aiData.choices?.[0]?.message?.content || "No se pudo generar el resumen.";

      const ttsResp = await fetch(
        `https://${speechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-16khz-32kbitrate-mono-mp3",
            "Ocp-Apim-Subscription-Key": speechKey
          },
          body: `
            <speak version="1.0" xml:lang="es-ES">
              <voice xml:lang="es-MX" xml:gender="Male" name="es-MX-GerardoNeural">
                ${summary}
              </voice>
            </speak>`
        }
      );

      if (!ttsResp.ok) throw new Error("Error al generar audio con Speech");
      const audioBuffer = Buffer.from(await ttsResp.arrayBuffer());

      return { 
        status: 200,
        headers: { 
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        },
        jsonBody: { success: true, summary, text: chunk, audio: audioBuffer.toString("base64") } 
      };
    } catch (err) {
      context.error("Error completo:", err);
      return { 
        status: 500, 
        headers: { 
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        },
        jsonBody: { success: false, error: err.message } 
      };
    }
  }
});
