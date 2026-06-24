#!/usr/bin/env python3
"""
slide_to_images.py — Convert .pptx slides to PNG images

Uses LibreOffice headless mode to convert .pptx → PDF, then splits PDF pages
into individual PNG images for vision model review.

Usage:
    python3 scripts/slide_to_images.py /path/to/deck.pptx /path/to/output/dir/

Output:
    Creates slide_1.png, slide_2.png, etc. in the output directory.
    Prints JSON status to stdout.

Dependencies:
    - LibreOffice (for .pptx → .pdf conversion)
    - Pillow / pdf2image (for .pdf → .png splitting)
    
    If LibreOffice is not installed, exits gracefully with an error JSON.
"""

import sys
import os
import json
import shutil
import subprocess
import tempfile


def check_libreoffice():
    """Check if LibreOffice is available."""
    # Try common paths
    candidates = [
        "libreoffice",
        "soffice",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        "/usr/bin/libreoffice",
        "/usr/local/bin/libreoffice",
    ]
    
    for cmd in candidates:
        if shutil.which(cmd):
            return cmd
    
    return None


def convert_pptx_to_pdf(pptx_path, output_dir, libreoffice_cmd):
    """Convert .pptx to .pdf using LibreOffice headless."""
    try:
        result = subprocess.run(
            [libreoffice_cmd, "--headless", "--convert-to", "pdf", "--outdir", output_dir, pptx_path],
            capture_output=True,
            text=True,
            timeout=120  # 2 minute timeout
        )
        
        if result.returncode != 0:
            return None, f"LibreOffice conversion failed: {result.stderr}"
        
        # Find the generated PDF
        basename = os.path.splitext(os.path.basename(pptx_path))[0]
        pdf_path = os.path.join(output_dir, f"{basename}.pdf")
        
        if not os.path.exists(pdf_path):
            return None, f"PDF not found at expected path: {pdf_path}"
        
        return pdf_path, None
    except subprocess.TimeoutExpired:
        return None, "LibreOffice conversion timed out after 120s"
    except Exception as e:
        return None, f"LibreOffice error: {str(e)}"


def pdf_to_pngs(pdf_path, output_dir):
    """Convert PDF pages to individual PNG images."""
    try:
        from pdf2image import convert_from_path
        
        images = convert_from_path(
            pdf_path,
            dpi=150,  # Good balance of quality vs size
            fmt="png"
        )
        
        image_paths = []
        for i, img in enumerate(images):
            img_path = os.path.join(output_dir, f"slide_{i + 1}.png")
            img.save(img_path, "PNG")
            image_paths.append(img_path)
        
        return image_paths, None
    except ImportError:
        # Try Pillow-based fallback
        try:
            from PIL import Image
            # Pillow can't natively read PDFs without additional deps, try subprocess
            return pdf_to_pngs_via_subprocess(pdf_path, output_dir)
        except Exception:
            return [], "pdf2image not installed. Install with: pip3 install pdf2image"
    except Exception as e:
        return [], f"PDF to PNG conversion failed: {str(e)}"


def pdf_to_pngs_via_subprocess(pdf_path, output_dir):
    """Fallback: use pdftoppm (poppler) to convert PDF to PNGs."""
    pdftoppm = shutil.which("pdftoppm")
    if not pdftoppm:
        return [], "Neither pdf2image nor pdftoppm (poppler) is available"
    
    try:
        output_prefix = os.path.join(output_dir, "slide")
        subprocess.run(
            [pdftoppm, "-png", "-r", "150", pdf_path, output_prefix],
            capture_output=True,
            text=True,
            timeout=60
        )
        
        # pdftoppm generates files like slide-1.png, slide-2.png
        image_paths = []
        for f in sorted(os.listdir(output_dir)):
            if f.startswith("slide") and f.endswith(".png"):
                old_path = os.path.join(output_dir, f)
                # Rename to slide_1.png format
                num = f.replace("slide-", "").replace("slide", "").replace(".png", "").strip("-")
                new_path = os.path.join(output_dir, f"slide_{num}.png")
                os.rename(old_path, new_path)
                image_paths.append(new_path)
        
        return image_paths, None
    except Exception as e:
        return [], f"pdftoppm conversion failed: {str(e)}"


def main():
    if len(sys.argv) < 3:
        print(json.dumps({
            "success": False,
            "error": "Usage: python3 slide_to_images.py <pptx_path> <output_dir>"
        }))
        sys.exit(1)
    
    pptx_path = sys.argv[1]
    output_dir = sys.argv[2]
    
    if not os.path.exists(pptx_path):
        print(json.dumps({
            "success": False,
            "error": f"File not found: {pptx_path}"
        }))
        sys.exit(1)
    
    # Check LibreOffice
    lo_cmd = check_libreoffice()
    if not lo_cmd:
        print(json.dumps({
            "success": False,
            "error": "LibreOffice is not installed. Vision review is disabled. Install with: brew install --cask libreoffice (macOS) or apt install libreoffice (Ubuntu)",
            "libreoffice_missing": True
        }))
        sys.exit(0)  # Exit 0 — this is a graceful "not available", not an error
    
    # Create output dir
    os.makedirs(output_dir, exist_ok=True)
    
    # Step 1: Convert to PDF
    with tempfile.TemporaryDirectory() as tmp_dir:
        pdf_path, err = convert_pptx_to_pdf(pptx_path, tmp_dir, lo_cmd)
        if err:
            print(json.dumps({"success": False, "error": err}))
            sys.exit(1)
        
        # Step 2: PDF → PNGs
        image_paths, err = pdf_to_pngs(pdf_path, output_dir)
        if err:
            print(json.dumps({"success": False, "error": err}))
            sys.exit(1)
    
    print(json.dumps({
        "success": True,
        "image_count": len(image_paths),
        "images": image_paths,
        "output_dir": output_dir
    }))


if __name__ == "__main__":
    main()
