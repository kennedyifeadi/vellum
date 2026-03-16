import os

path = r"c:\Users\USER\Desktop\Wed development\vellum\components\dashboard\SideDrawer.tsx"
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old_block = """  // Validate action constraints
  const isActionDisabled = () => {
    if (!selectedTool) return true;
    if (fileList.length === 0) return true;

    switch (selectedTool) {"""

new_block = """  // Validate action constraints
  const isActionDisabled = () => {
    if (!selectedTool) return true;
    
    // Ignore file list checking if in HTML URL mode
    const isHtmlUrl = selectedTool === 'html-to-pdf' && htmlOptions.mode === 'url';
    if (fileList.length === 0 && !isHtmlUrl) return true;

    switch (selectedTool) {"""

if old_block in content:
    content = content.replace(old_block, new_block)
else:
    # Try CRLF
    old_crlf = old_block.replace("\n", "\r\n")
    new_crlf = new_block.replace("\n", "\r\n")
    if old_crlf in content:
        content = content.replace(old_crlf, new_crlf)
    else:
        print("Block not found literally, trying fallback")
        # Fallback using splitting
        if "if (fileList.length === 0) return true;" in content:
             content = content.replace("if (fileList.length === 0) return true;", "const isHtmlUrl = selectedTool === 'html-to-pdf' && htmlOptions.mode === 'url';\n    if (fileList.length === 0 && !isHtmlUrl) return true;")

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Replacement complete")
