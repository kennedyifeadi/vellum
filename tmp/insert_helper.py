import os

path = r"c:\Users\USER\Desktop\Wed development\vellum\components\dashboard\SideDrawer.tsx"
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

helper_code = """
  // Validate action constraints
  const isActionDisabled = () => {
    if (!selectedTool) return true;
    if (fileList.length === 0) return true;

    switch (selectedTool) {
      case 'merge-pdf':
        return fileList.length < 2;
      case 'split-pdf':
        return !splitOptions.startPage || !splitOptions.endPage;
      case 'lock-pdf':
        return lockOptions.password.length < 6 || lockOptions.password !== lockOptions.confirmPassword;
      case 'find-pdf':
        return !findOptions.searchTerm.trim();
      default:
        return false;
    }
  };

"""

# Find the location to insert: After renderToolInputs definition end, before return (
anchor = "  };\n\n\n\n  return ("
if anchor in content:
    content = content.replace(anchor, "  };" + helper_code + "\n  return (")
else:
    # Try with CRLF
    anchor_crlf = "  };\r\n\r\n\r\n\r\n  return ("
    if anchor_crlf in content:
        content = content.replace(anchor_crlf, "  };" + helper_code + "\r\n  return (")
    else:
        # Fallback to general finding
        parts = content.split("  return (")
        if len(parts) > 1:
             # Find the last function definition before return
             parts[0] = parts[0] + helper_code
             content = "  return (".join(parts)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Insertion complete")
