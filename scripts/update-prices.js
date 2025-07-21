// scripts/update-prices.js

import { Client } from '@notionhq/client';
import fetch from 'node-fetch';

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const ASSETS_DB = process.env.NOTION_ASSETS_DB_ID
const PRICES_DB = process.env.NOTION_PRICES_DB_ID;
const PRICE_API = 'https://hf-watcher.twsling2021.workers.dev/api/price';

async function runPriceUpdate() {
    // 1. Query all Assets with Token ID  
    const assets = [];
    let cursor = undefined;
    do {
        const resp = await notion.databases.query({
            database_id: ASSETS_DB,
            start_cursor: cursor,
            filter: {
                property: 'Token ID',
                rich_text: { is_not_empty: true }
            }
        });
        assets.push(...resp.results);
        cursor = resp.has_more ? resp.next_cursor : undefined;
    } while (cursor);

    // 2. For each Asset, fetch price & upsert Prices row
    for (const page of assets) {
        const tokenId = page.properties['Token ID'].rich_text[0].plain_text;
        const ticker = page.properties.Ticker.rich_text[0].plain_text;

        // fetch ADA-per-token price
        const { priceAda } = await fetch(`${PRICE_API}/${tokenId}`)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            });

        // look for existing Price page
        const existing = await notion.databases.query({
            database_id: PRICES_DB,
            filter: {
                property: 'Token',
                relation: { contains: page.id }
            }
        });

        const props = {
            Token: {
                relation: [{ id: page.id }]
            },
            'ADA Price': {
                number: priceAda
            },
            'Last Updated': {
                date: { start: new Date().toISOString() }
            }
        };

        if (existing.results.length) {
            await notion.pages.update({
                page_id: existing.results[0].id,
                properties: props
            });
            console.log(`Updated ${ticker}: ${priceAda}`);
        } else {
            await notion.pages.create({
                parent: { database_id: PRICES_DB },
                properties: props
            });
            console.log(`Created ${ticker}: ${priceAda}`);
        }
    }
}

runPriceUpdate().catch(err => {
    console.error(err);
    process.exit(1);
});
