import * as fs from "fs";
import * as path from "path";
import * as Mocha from "mocha";

/**
 * ディレクトリを再帰的に走査してテストファイルを集める
 *
 * この関数はVS Codeの拡張機能ホストの中で動く。サポートする最も古いVS Codeの
 * 拡張機能ホストは古いNode.jsのため、新しいNode.jsを要求するglobや、
 * Node.js 18.17未満に無い`fs.readdirSync`の`recursive`オプションは使わず、
 * `withFileTypes`(Node.js 10以降)だけで実装する
 *
 * @param directory 走査するディレクトリ
 * @param testsRoot パスを相対化する基準のディレクトリ
 * @returns testsRootからの相対パスの一覧
 */
function findTestFiles(directory: string, testsRoot: string): string[] {
  const files: string[] = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...findTestFiles(entryPath, testsRoot));
    } else if (entry.isFile() && entry.name.endsWith(".test.js")) {
      files.push(path.relative(testsRoot, entryPath));
    }
  }

  return files;
}

export async function run(): Promise<void> {
  // Create the mocha test
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
    timeout: "20s",
  });

  const testsRoot = path.resolve(__dirname, "..");

  const files = findTestFiles(testsRoot, testsRoot);

  // Add files to the test suite
  files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

  return new Promise((c, e) => {
    try {
      // Run the mocha test
      mocha.run((failures) => {
        if (failures > 0) {
          e(new Error(`${failures.toString()} tests failed.`));
        } else {
          c();
        }
      });
    } catch (err) {
      console.error(err);
      e(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
