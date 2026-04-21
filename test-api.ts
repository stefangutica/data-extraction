import * as fs from 'fs';
import { parse } from 'csv-parse/sync';

// API Configuration (adjust the port if necessary)
const API_URL = 'http://localhost:3000/api/match-company';

interface InputRow {
  'input_name': string;
  'input_phone': string;
  'input_website': string;
  'input_facebook': string;
}

async function runMatcher() {
  console.log('🔄 Starting data processing...\n');
  const startTime = Date.now();

  const inputFileName = './API-input-sample.csv';
  const outputFileName = './match-results.json';

  // 1. Check and read the input file
  if (!fs.existsSync(inputFileName)) {
    console.error(`❌ Error: File "${inputFileName}" was not found in the current directory.`);
    return;
  }

  const fileContent = fs.readFileSync(inputFileName, 'utf-8');
  const records: InputRow[] = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const results = [];
  const stats = {
    total: records.length,
    matched: 0,
    notFound: 0,
    errors: 0,
  };

  // 2. Iterate through each row sequentially
  for (const [index, row] of records.entries()) {
    const payload = {
      name: row['input_name'] || null,
      phone_number: row['input_phone'] || null,
      website: row['input_website'] || null,
      facebook_profile: row['input_facebook'] || null,
    };

    process.stdout.write(`[${index + 1}/${stats.total}] Searching for: ${payload.name || payload.website || 'Entity'}... `);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const company = await response.json();
        stats.matched++;
        console.log(`✅ MATCHED`);
        
        // Save the formatted result for JSON
        results.push({
          input_data: row,
          match_status: 'MATCHED',
          matched_company: company
        });
      } else if (response.status === 404) {
        stats.notFound++;
        console.log(`❌ NOT FOUND`);
        results.push({
          input_data: row,
          match_status: 'NOT FOUND',
          matched_company: null
        });
      } else {
        stats.errors++;
        console.log(`⚠️ SERVER ERROR (${response.status})`);
        results.push({
          input_data: row,
          match_status: `ERROR_${response.status}`,
          matched_company: null
        });
      }
    } catch (error: any) {
      stats.errors++;
      console.log(`🔥 NETWORK ERROR (${error.message})`);
      results.push({
        input_data: row,
        match_status: 'NETWORK_ERROR',
        matched_company: null
      });
    }
  }

  // 3. Write the results to the JSON file, formatted with 2 spaces (pretty print)
  fs.writeFileSync(outputFileName, JSON.stringify(results, null, 2), 'utf-8');

  // 4. Display the final statistics
  const endTime = Date.now();
  const timeTakenSec = ((endTime - startTime) / 1000).toFixed(2);
  const matchRate = ((stats.matched / stats.total) * 100).toFixed(2);

  console.log('\n========================================');
  console.log('📊 FINAL STATISTICS:');
  console.log('========================================');
  console.log(`Total processed:   ${stats.total}`);
  console.log(`✅ Found (Match):  ${stats.matched} (${matchRate}%)`);
  console.log(`❌ Not found:      ${stats.notFound}`);
  console.log(`⚠️ Errors:         ${stats.errors}`);
  console.log(`⏱️ Total time:      ${timeTakenSec} seconds`);
  console.log('========================================');
  console.log(`📂 Results have been saved to "${outputFileName}"`);
}

runMatcher().catch((error) => console.error('Fatal error in script:', error));