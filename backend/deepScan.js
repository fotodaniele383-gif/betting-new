// ==========================================
// MODULO DEEP SCAN AI - deepScan.js
// Versione 2.0: URL Injection Method (Zero Failure)
// ==========================================
const puppeteer = require('puppeteer');

class DeepScanAI {
    
    delay(time) {
        return new Promise(resolve => setTimeout(resolve, time));
    }

    // Trasforma "Jannik Sinner" in "jannik-sinner"
    slugify(name) {
        return name.toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    async scanMatchup(p1NameRaw, p2NameRaw) {
        // 1. Pulizia nomi per URL (es. Sinner J. -> jannik-sinner o sinner)
        // Se il nome è "Sinner J.", dobbiamo essere sicuri di avere il nome completo o tentare lo slug
        const p1Slug = this.slugify(p1NameRaw.replace(/\s[A-Z]\./, '')); 
        const p2Slug = this.slugify(p2NameRaw.replace(/\s[A-Z]\./, ''));
        
        // Costruiamo l'URL diretto come visto nello screenshot
        const targetUrl = `https://stats.tennismylife.org/h2h/${p1Slug}-vs-${p2Slug}`;
        
        console.log(`\n🔍 [DEEP SCAN AI] URL Injection: ${targetUrl}`);
        
        let browser;
        try {
            browser = await puppeteer.launch({
                headless: "new",
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

            // Navigazione diretta
            const response = await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

            // Se l'URL diretto fallisce (404), tentiamo l'inversione (p2-vs-p1)
            if (response.status() === 404) {
                console.log(`⚠️ URL non trovato, provo inversione...`);
                await page.goto(`https://stats.tennismylife.org/h2h/${p2Slug}-vs-${p1Slug}`, { waitUntil: 'networkidle2' });
            }

            await this.delay(2000); // Buffer per rendering Ajax dei testi

            const bodyText = await page.evaluate(() => document.body.innerText);
            
            // Verifichiamo la presenza dei dati
            if (!bodyText.includes("overall career record") && !bodyText.includes("win rate")) {
                throw new Error("Dati statistici non presenti nella pagina caricata.");
            }

            const report = this.analyzeText(bodyText, p1NameRaw, p2NameRaw);
            
            await browser.close();
            return report;

        } catch (error) {
            if (browser) await browser.close();
            console.error(`❌ [DEEP SCAN AI] Errore: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    analyzeText(text, p1, p2) {
        let stats = {
            h2hWins: 0,
            h2hLosses: 0,
            p1Top10WinRate: 0,
            p2Top10WinRate: 0,
            p1CareerWinRate: 0,
            p2CareerWinRate: 0
        };

        // NLP: Estrazione H2H dal testo
        // "have met X times. Player currently holds the upper hand, leading the series 3-0"
        const h2hMatch = text.match(/leading the series (\d+)[–-](\d+)/i);
        if (h2hMatch) {
            stats.h2hWins = parseInt(h2hMatch[1]);
            stats.h2hLosses = parseInt(h2hMatch[2]);
        }

        // NLP: Record contro Top 10
        const top10Regex = /Against Top 10 opponents.*?([\d.]+)%/gi;
        const top10Matches = [...text.matchAll(top10Regex)];
        if (top10Matches.length >= 1) stats.p1Top10WinRate = parseFloat(top10Matches[0][1]);
        if (top10Matches.length >= 2) stats.p2Top10WinRate = parseFloat(top10Matches[1][1]);

        // NLP: Career Win Rate
        const careerRegex = /win rate of ([\d.]+)%/gi;
        const careerMatches = [...text.matchAll(careerRegex)];
        if (careerMatches.length >= 1) stats.p1CareerWinRate = parseFloat(careerMatches[0][1]);
        if (careerMatches.length >= 2) stats.p2CareerWinRate = parseFloat(careerMatches[1][1]);

        // --- LOGICA DI VERDETTO ---
        let action = "🟢 CONFERMATO";
        let reason = "Parametri di carriera in linea con l'Edge calcolato.";
        let risk = 0;

        // Se lo sfavorito (P2) ha un win rate contro i Top 10 infimo (<25%)
        if (stats.p2Top10WinRate > 0 && stats.p2Top10WinRate < 25) {
            risk += 4;
            reason = `${p2} ha un record pessimo contro i Top 10 (${stats.p2Top10WinRate}%).`;
        }

        // Se l'H2H è schiacciante (Sinner 3-0 o più)
        if (stats.h2hWins >= 3 && stats.h2hLosses === 0) {
            risk += 3;
            reason += ` Dominio H2H totale (${stats.h2hWins}-0).`;
        }

        if (risk >= 6) action = "❌ PERICOLO: VALUE TRAP";
        else if (risk >= 3) action = "⚠️ ATTENZIONE: ALTO RISCHIO";

        return {
            success: true,
            action: action,
            reason: reason,
            metrics: stats
        };
    }
}

module.exports = new DeepScanAI();