import os

path = r"c:\Users\USER\Desktop\Wed development\vellum\components\dashboard\SideDrawer.tsx"
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

helper_code = """
  // Determine file types accepted based on selected tool
  const getAcceptAttribute = () => {
    switch (selectedTool) {
      case 'merge-pdf':
      case 'split-pdf':
      case 'lock-pdf':
      case 'find-pdf':
        return '.pdf';
      case 'image-to-pdf':
        return '.jpg,.jpeg,.png';
      case 'jpeg-to-png':
        return '.jpg,.jpeg';
      case 'docx-to-pdf':
        return '.docx,.doc';
      case 'html-to-pdf':
        return '.html';
      default:
        return '.pdf,.docx,.doc,.jpg,.jpeg,.png';
    }
  };

"""

anchor = "  };\n\n\n  return ("
if anchor in content:
    content = content.replace(anchor, "  };" + helper_code + "\n  return (")
else:
    anchor_crlf = "  };\r\n\r\n\r\n  return ("
    if anchor_crlf in content:
        content = content.replace(anchor_crlf, "  };" + helper_code + "\r\n  return (")
    else:
        # Fallback split
        parts = content.split("  return (")
        if len(parts) > 1:
             parts[0] = parts[0] + helper_code
             content = "  return (".join(parts)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Insertion complete")
