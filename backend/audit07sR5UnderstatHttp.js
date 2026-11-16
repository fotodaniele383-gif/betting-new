'use strict';
const https = require('node:https');
const zlib = require('node:zlib');

const AUDIT16D_R3_R3A_R4_HTTP_WIRE_VERSION = 'AUDIT16D_R3_R3A_R4_UNDERSTAT_GZIP_WIRE_DECODE_V1';
const MAX_UNDERSTAT_BODY_BYTES = 4 * 1024 * 1024;

function decodeUnderstatBody(buffer, headers = {}) {
    const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
    const encoding = String(headers['content-encoding'] || headers['Content-Encoding'] || '').toLowerCase();
    const isGzipMagic = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b;
    const opts = { maxOutputLength: MAX_UNDERSTAT_BODY_BYTES + 1 };
    let decoded = raw;
    try {
        if (/\bbr\b/.test(encoding)) decoded = zlib.brotliDecompressSync(raw, opts);
        else if (/\bgzip\b/.test(encoding) || isGzipMagic) decoded = zlib.gunzipSync(raw, opts);
        else if (/\bdeflate\b/.test(encoding)) {
            try { decoded = zlib.inflateSync(raw, opts); }
            catch (_) { decoded = zlib.inflateRawSync(raw, opts); }
        }
    } catch (cause) {
        const error = new Error('UNDERSTAT_CONTENT_DECODE_FAILED');
        error.code = 'UNDERSTAT_CONTENT_DECODE_FAILED';
        error.structural = true;
        error.cause = cause;
        throw error;
    }
    if (decoded.length > MAX_UNDERSTAT_BODY_BYTES) {
        const error = new Error('UNDERSTAT_DECOMPRESSED_BODY_TOO_LARGE');
        error.code = 'UNDERSTAT_DECOMPRESSED_BODY_TOO_LARGE';
        error.structural = true;
        throw error;
    }
    return decoded;
}

// One deadline includes connection, response body and HTML redirects.
// No bypass of denied responses; only public HTTPS Understat hosts are allowed.
function fetchUnderstatText(url, options = {}) {
    const prefix = options.json ? 'UNDERSTAT_AJAX' : 'UNDERSTAT';
    const configured = Number(options.timeoutMs);
    const timeoutMs = Number.isFinite(configured) && configured > 0 ? Math.min(configured, 25000) : 25000;
    return new Promise((resolve, reject) => {
        let settled = false, request, response;
        const error = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });
        const finish = (err, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(deadline);
            if (err) {
                // Mark settled before destruction: destroy may emit error synchronously.
                response?.destroy();
                request?.destroy();
                reject(err);
            } else resolve(value);
        };
        const deadline = setTimeout(() => finish(error('UNDERSTAT_NETWORK_TIMEOUT', { transient: true })), timeoutMs);
        function visit(target, redirects) {
            if (settled) return;
            let parsed;
            try { parsed = new URL(target); } catch (_) { finish(error('UNDERSTAT_REDIRECT_INVALID', { structural: true })); return; }
            if (parsed.protocol !== 'https:' || !['understat.com', 'www.understat.com'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.port) {
                finish(error('UNDERSTAT_REDIRECT_NOT_ALLOWED', { structural: true })); return;
            }
            try {
                request = https.get(parsed.toString(), { headers: options.headers || {}, timeout: timeoutMs }, res => {
                    response = res;
                    // Keep error listeners installed even after destroy to avoid an unhandled error.
                    res.on('error', e => finish(Object.assign(e, { transient: true })));
                    res.on('aborted', () => finish(error('UNDERSTAT_RESPONSE_ABORTED', { transient: true })));
                    if (settled) { res.destroy(); return; }
                    const statusCode = res.statusCode || 0;
                    if (!options.json && statusCode >= 300 && statusCode < 400 && res.headers.location) {
                        res.resume();
                        if (redirects >= 3) { finish(error('UNDERSTAT_REDIRECT_LIMIT', { structural: true })); return; }
                        let next;
                        try { next = new URL(res.headers.location, parsed).toString(); }
                        catch (_) { finish(error('UNDERSTAT_REDIRECT_INVALID', { structural: true })); return; }
                        // Drain the current response before starting another connection.
                        res.once('end', () => visit(next, redirects + 1));
                        return;
                    }
                    if (statusCode !== 200) {
                        finish(error(`${prefix}_HTTP_${statusCode}`, { transient: statusCode >= 500 || statusCode === 429, notFound: statusCode === 404 }));
                        return;
                    }
                    let size = 0;
                    const chunks = [];
                    res.on('data', chunk => {
                        if (settled) return;
                        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                        size += bytes.length;
                        if (size > 4 * 1024 * 1024) {
                            finish(error(options.json ? 'UNDERSTAT_AJAX_JSON_TOO_LARGE' : 'UNDERSTAT_HTML_TOO_LARGE', { structural: true }));
                            return;
                        }
                        chunks.push(bytes);
                    });
                    res.once('end', () => {
                        if (res.complete === false) { finish(error('UNDERSTAT_RESPONSE_INCOMPLETE', { transient: true })); return; }
                        let body;
                        try { body = decodeUnderstatBody(Buffer.concat(chunks), res.headers || {}); }
                        catch (decodeError) { finish(decodeError); return; }
                        if (body.length > MAX_UNDERSTAT_BODY_BYTES) {
                            finish(error(options.json ? 'UNDERSTAT_AJAX_JSON_TOO_LARGE' : 'UNDERSTAT_HTML_TOO_LARGE', { structural: true }));
                            return;
                        }
                        finish(null, {
                            text: body.toString('utf8'),
                            finalUrl: parsed.toString(),
                            statusCode,
                            headers: res.headers || {},
                            wireDecodeVersion: AUDIT16D_R3_R3A_R4_HTTP_WIRE_VERSION
                        });
                    });
                });
                request.on('timeout', () => finish(error('UNDERSTAT_NETWORK_TIMEOUT', { transient: true })));
                request.on('error', e => finish(Object.assign(e, { code: e.code || 'UNDERSTAT_NETWORK_ERROR', transient: true })));
            } catch (e) { finish(e); }
        }
        visit(url, 0);
    });
}
module.exports = { fetchUnderstatText, decodeUnderstatBody, AUDIT16D_R3_R3A_R4_HTTP_WIRE_VERSION };
