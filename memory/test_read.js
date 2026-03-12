const fs = require('fs');
try {
  const content = fs.readFileSync('src/dialogue/handler.js', 'utf8');
  const lines = content.split('\n');
  console.log('文件总行数:', lines.length);
  console.log('最后50行:');
  for (let i = Math.max(0, lines.length - 50); i < lines.length; i++) {
    console.log(`${i+1}: ${lines[i]}`);
  }
} catch (e) {
  console.error('读取错误:', e.message);
}