import fs from "fs";
import path from "path";

const appRoot = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..");

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

for (const p of walk(path.join(appRoot, "src"))) {
  let s = fs.readFileSync(p, "utf8");
  const original = s;

  if (s.includes("coinQueryKey(") && !s.includes('from "@/lib/coin/profile"')) {
    const importLine = 'import { coinQueryKey } from "@/lib/coin/profile";\n';
    if (s.includes('from "@/lib/rpc/client"')) {
      s = s.replace(/(import[^\n]+from "@\/lib\/rpc\/client";?\n)/, `$1${importLine}`);
    } else if (s.includes('from "@/lib/address-book"')) {
      s = s.replace(/(import[^\n]+from "@\/lib\/address-book";?\n)/, `$1${importLine}`);
    } else {
      s = importLine + s;
    }
  }

  if (
    s.match(/\bcoinQueryKey\(coin/) &&
    !s.includes('from "@/lib/coin/context"')
  ) {
    const importLine = 'import { useActiveCoin } from "@/lib/coin/context";\n';
    if (s.includes('from "@/lib/coin/profile"')) {
      s = s.replace(
        /(import[^\n]+from "@\/lib\/coin\/profile";?\n)/,
        `$1${importLine}`,
      );
    } else {
      s = importLine + s;
    }
  }

  if (s.match(/\bcoinQueryKey\(coin/) && !s.includes("const coin = useActiveCoin()")) {
    s = s.replace(
      /export function (\w+)\([^)]*\) \{\n(?!\s*const coin = useActiveCoin)/,
      (match) => `${match}  const coin = useActiveCoin();\n`,
    );
  }

  s = s.replace(
    /queryClient\.invalidateQueries\(\{ queryKey: \["getmininginfo"\] \}\)/g,
    'queryClient.invalidateQueries({ queryKey: coinQueryKey(coin, "getmininginfo") })',
  );
  s = s.replace(
    /queryClient\.setQueryData\(\["get_miner_state"\]/g,
    'queryClient.setQueryData(coinQueryKey(coin, "get_miner_state")',
  );

  if (s !== original) {
    fs.writeFileSync(p, s);
    console.log("fixed", path.relative(appRoot, p));
  }
}
