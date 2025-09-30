import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import puppeteer from "puppeteer";
import sharp from "sharp";
import "dotenv/config";

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

const app = express();
const PORT = 5050;

// enable CORS for all routes
app.use(cors());

app.get("/api/ig-thumbnail", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "Missing url parameter" });

    try {
        // Fetch the Instagram thumbnail URL (your existing logic)
        const mediaUrl = url.replace(/\?.*$/, "").replace(/\/$/, "") + "/media?size=l";
        const response = await fetch(mediaUrl, { redirect: "follow" });
        const cdnUrl = response.url;

        // Upload to Supabase
        const filename = `${Date.now()}.jpg`;
        const publicUrl = await uploadInstagramThumbnail(cdnUrl, filename);

        res.json({ imageUrl: publicUrl });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});


app.get("/api/bandcamp-oembed", async (req, res) => {
    const { url } = req.query;

    if (!url) return res.status(400).json({ error: "Missing url" });

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        });

        const page = await browser.newPage();

        // Set realistic headers
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1366, height: 768 });

        await page.goto(url, { waitUntil: 'networkidle2' });

        // Extract data like Substack does
        const metadata = await page.evaluate(() => {

            // 2. Extract Bandcamp-specific data from page variables
            let bandcampData = {};
            let embedId = '';
            let itemType = 'track'; // default

            try {
                // Bandcamp stores data in window.TralbumData
                if (window.TralbumData) {
                    bandcampData = window.TralbumData;
                    embedId = bandcampData.id;
                    itemType = bandcampData.item_type;
                }
            } catch (e) {
                console.log('Could not extract TralbumData');
            }

            // 3. Try to get ID from page source patterns
            if (!embedId) {
                const scripts = Array.from(document.querySelectorAll('script'));
                for (const script of scripts) {
                    const content = script.textContent || '';
                    // Look for album/track IDs in various formats
                    const albumMatch = content.match(/album["\s]*[:=]["\s]*(\d+)/);
                    const trackMatch = content.match(/track["\s]*[:=]["\s]*(\d+)/);

                    if (albumMatch) {
                        embedId = albumMatch[1];
                        itemType = 'album';
                        break;
                    }
                    if (trackMatch) {
                        embedId = trackMatch[1];
                        itemType = 'track';
                        break;
                    }
                }
            }

            return {
                bandcamp_id: embedId,
                item_type: itemType,
            };
        });

        res.json(metadata);

    } catch (error) {
        console.error('Scraping error:', error);
        res.status(500).json({ error: "Failed to extract metadata" });
    } finally {
        if (browser) await browser.close();
    }
});


app.listen(PORT, () =>
    console.log(`✅ Server running on http://localhost:${PORT}`)
);


async function uploadInstagramThumbnail(imageUrl, filename) {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error("Failed to fetch image");

    const buffer = await response.arrayBuffer();

    const compressed = await sharp(Buffer.from(buffer))
        .resize(800)
        .jpeg({ quality: 80 })
        .toBuffer();

    const { data, error } = await supabase.storage
        .from("ig-covers")
        .upload(filename, compressed, {
            cacheControl: "3600",
            upsert: true,
            contentType: response.headers.get("content-type") || "image/jpeg",
        });

    if (error) throw error;

    return filename;
}