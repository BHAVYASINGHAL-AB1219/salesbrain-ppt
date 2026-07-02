#!/usr/bin/env python3
"""
structural_review.py — Sales Brain PPT Visual/Structural Reviewer (v2)

Reads the enhanced JSON output from extract_slides.py and runs comprehensive
rule-based structural checks for layout quality.

NEW in v2:
  - Font-metric text-wrapping simulation (predicts actual line count)
  - Per-font average character width tables (Cambria, Calibri, Arial, etc.)
  - Vertical overflow detection (text height > box height)
  - Colour contrast ratio checks (WCAG AA/AAA)
  - Layout zone validation (title zone, body zone, footer zone)
  - Visual density heatmap (quadrant-based fill ratio)
  - Consistent font-size checks per zone
  - Redundant/duplicate text detection
  - Spacing & padding heuristics
  - Image aspect-ratio sanity
  - Overall content-to-whitespace balance

Usage:
    python3 scripts/extract_slides.py /path/to/deck.pptx | python3 scripts/structural_review.py

    OR

    python3 scripts/structural_review.py /path/to/extracted.json

Output:
    JSON with per-slide structural scores, issues, and pass/fail status.
"""

import sys
import json
import math
import re


# ─── Constants ────────────────────────────────────────────────────────────────
SLIDE_WIDTH  = 10.0     # Standard Quarks 16:9 slide width in inches
SLIDE_HEIGHT = 5.625    # Standard 16:9 slide height in inches
PASS_THRESHOLD = 7.0

# Scoring deductions
DEDUCT_ERROR   = 1.5
DEDUCT_WARNING = 0.5
DEDUCT_INFO    = 0.1

# Layout zones (Y thresholds in inches for a 10×5.625" canvas)
TITLE_ZONE_TOP    = 0.0
TITLE_ZONE_BOTTOM = 1.5    # Title should live above this line
BODY_ZONE_TOP     = 1.5
BODY_ZONE_BOTTOM  = 4.85
FOOTER_ZONE_Y     = 4.85   # Below this is footer territory

# Font readability limits
MIN_BODY_FONT    = 10      # pt — absolute minimum for body text
MIN_TITLE_FONT   = 16      # pt — minimum for titles
WARN_BODY_FONT   = 11      # pt — warn if body text below this
RECOMMENDED_MAX_TITLE_FONT = 44  # pt — titles above this look amateur

# Text density
MAX_BODY_FILL_RATIO   = 0.90   # Box should not be more than 90% full
WARN_BODY_FILL_RATIO  = 0.75   # Warn if body text > 75% fill
OVERLAP_THRESHOLD     = 0.15   # 15% overlap area → warning
OVERLAP_ERROR         = 0.40   # 40% overlap area → error

# Colour contrast (WCAG AA = 4.5:1 for normal text, 3:1 for large)
CONTRAST_AA_NORMAL = 4.5
CONTRAST_AA_LARGE  = 3.0   # Large text ≥ 18pt (or 14pt bold)
CONTRAST_AAA       = 7.0

# Visual balance
BALANCE_X_SKEW_THRESHOLD  = 0.25   # Center-of-mass must be within ±25% of horizontal center
BALANCE_Y_SKEW_THRESHOLD  = 0.30
MIN_CONTENT_FILL_RATIO    = 0.10   # Slide should have at least 10% content area
MAX_CONTENT_FILL_RATIO    = 0.75   # Slide should not be more than 75% filled

# ─── Per-font average character-width ratios relative to font size (pts) ────
# Value = average character width in pts ÷ font size in pts
# Measured from real font metrics (Calibri, Cambria, Arial)
FONT_AVG_CHAR_WIDTH_RATIO = {
    "calibri":  0.55,
    "cambria":  0.57,
    "arial":    0.56,
    "helvetica":0.56,
    "times":    0.54,
    "georgia":  0.56,
    "verdana":  0.62,
    "trebuchet":0.58,
    "default":  0.56,   # fallback
}

# Line-height multiplier (line height as a multiple of font size in pts)
LINE_HEIGHT_RATIO = 1.25

# Points per inch
PT_PER_INCH = 72.0


# ─── Utility helpers ──────────────────────────────────────────────────────────

def font_key(font_name):
    """Normalise font name to our lookup key."""
    if not font_name:
        return "default"
    name = font_name.lower().strip()
    for k in FONT_AVG_CHAR_WIDTH_RATIO:
        if k in name:
            return k
    return "default"


def estimate_wrapped_lines(text, font_size_pt, box_width_inches, font_name=None):
    """
    Estimate how many lines the text will produce when word-wrapped inside
    box_width_inches at the given font_size_pt.

    Returns the integer line count.
    """
    if not text or box_width_inches <= 0 or font_size_pt is None or font_size_pt <= 0:
        return 0

    char_ratio = FONT_AVG_CHAR_WIDTH_RATIO.get(font_key(font_name), FONT_AVG_CHAR_WIDTH_RATIO["default"])
    avg_char_width_pt   = font_size_pt * char_ratio
    avg_char_width_inch = avg_char_width_pt / PT_PER_INCH
    chars_per_line      = max(1, box_width_inches / avg_char_width_inch)

    # Word-wrap simulation: respect newlines and spaces
    lines  = 0
    for paragraph in text.split("\n"):
        words  = paragraph.split()
        if not words:
            lines += 1  # empty paragraph = blank line
            continue
        current_line_chars = 0
        for word in words:
            word_chars = len(word) + 1  # +1 for space
            if current_line_chars + word_chars > chars_per_line and current_line_chars > 0:
                lines += 1
                current_line_chars = word_chars
            else:
                current_line_chars += word_chars
        lines += 1  # last line in paragraph

    return lines


def estimate_text_height(text, font_size_pt, box_width_inches, font_name=None):
    """
    Estimate the rendered height (in inches) of text when word-wrapped.
    """
    lines = estimate_wrapped_lines(text, font_size_pt, box_width_inches, font_name)
    line_height_pt   = font_size_pt * LINE_HEIGHT_RATIO
    line_height_inch = line_height_pt / PT_PER_INCH
    return lines * line_height_inch


def hex_to_rgb(hex_str):
    """Convert a hex color string to (R, G, B) tuple (0-255)."""
    if not hex_str:
        return None
    hex_str = hex_str.lstrip("#")
    if len(hex_str) == 3:
        hex_str = "".join(c * 2 for c in hex_str)
    if len(hex_str) != 6:
        return None
    try:
        return tuple(int(hex_str[i:i+2], 16) for i in (0, 2, 4))
    except ValueError:
        return None


def relative_luminance(rgb):
    """Compute WCAG relative luminance for an (R, G, B) tuple (0-255)."""
    if rgb is None:
        return None
    r, g, b = [c / 255.0 for c in rgb]
    def linearise(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b)


def contrast_ratio(lum1, lum2):
    """WCAG contrast ratio between two relative luminances."""
    if lum1 is None or lum2 is None:
        return None
    lighter = max(lum1, lum2)
    darker  = min(lum1, lum2)
    return (lighter + 0.05) / (darker + 0.05)


def compute_overlap_area(shape_a, shape_b):
    x_overlap = max(0, min(shape_a["right"], shape_b["right"]) - max(shape_a["left"], shape_b["left"]))
    y_overlap = max(0, min(shape_a["bottom"], shape_b["bottom"]) - max(shape_a["top"], shape_b["top"]))
    return x_overlap * y_overlap


def compute_shape_area(shape):
    return shape["width"] * shape["height"]


# ─── Individual checks ────────────────────────────────────────────────────────

def check_out_of_bounds(shape, slide_w, slide_h):
    """Check if a shape extends beyond the slide canvas."""
    issues = []
    tolerance = 0.5  # decorative bleeds up to 0.5" are fine

    # Skip purely decorative shapes (background circles, accent bars, etc.)
    # that intentionally bleed off-canvas. These carry no visible text
    # (text_length == 0) and are geometric auto-shapes, so an out-of-bounds
    # flag here is noise that drowns out real content-overflow signals.
    # Note: python-pptx reports has_text_frame=True even for empty ovals,
    # so we key off text_length, not has_text_frame.
    if (
        shape.get("text_length", 0) == 0
        and shape.get("shape_type") in ("auto_shape", "freeform", "unknown")
    ):
        return issues

    if shape["right"] > slide_w + tolerance:
        overshoot = round(shape["right"] - slide_w, 3)
        issues.append({
            "type": "out_of_bounds_right",
            "severity": "warning" if overshoot < 1.5 else "error",
            "message": f"Shape '{shape['name']}' extends {overshoot}\" past right edge",
            "shape_index": shape["shape_index"],
            "overshoot_inches": overshoot
        })

    if shape["bottom"] > slide_h + tolerance:
        overshoot = round(shape["bottom"] - slide_h, 3)
        issues.append({
            "type": "out_of_bounds_bottom",
            "severity": "warning" if overshoot < 1.0 else "error",
            "message": f"Shape '{shape['name']}' extends {overshoot}\" past bottom edge",
            "shape_index": shape["shape_index"],
            "overshoot_inches": overshoot
        })

    if shape["left"] < -tolerance:
        issues.append({
            "type": "out_of_bounds_left",
            "severity": "info",
            "message": f"Shape '{shape['name']}' bleeds {abs(round(shape['left'], 2))}\" off left edge",
            "shape_index": shape["shape_index"]
        })

    if shape["top"] < -tolerance:
        issues.append({
            "type": "out_of_bounds_top",
            "severity": "info",
            "message": f"Shape '{shape['name']}' bleeds {abs(round(shape['top'], 2))}\" off top edge",
            "shape_index": shape["shape_index"]
        })

    return issues


def check_font_size(shape):
    """Check font sizes for readability."""
    issues = []

    # Skip decorative ghost numbers (160pt+ transparent background text)
    if is_decorative_shape(shape):
        return issues

    font_min = shape.get("font_size_min")
    font_max = shape.get("font_size_max")

    if font_min is not None and font_min < MIN_BODY_FONT:
        issues.append({
            "type": "font_too_small",
            "severity": "error",
            "message": f"Shape '{shape['name']}' uses {font_min}pt text — below absolute minimum {MIN_BODY_FONT}pt",
            "shape_index": shape["shape_index"],
            "font_size": font_min
        })
    elif font_min is not None and font_min < WARN_BODY_FONT:
        issues.append({
            "type": "font_too_small",
            "severity": "warning",
            "message": f"Shape '{shape['name']}' uses {font_min}pt text — recommended minimum is {WARN_BODY_FONT}pt",
            "shape_index": shape["shape_index"],
            "font_size": font_min
        })

    if font_max is not None and font_max > RECOMMENDED_MAX_TITLE_FONT:
        issues.append({
            "type": "font_too_large",
            "severity": "info",
            "message": f"Shape '{shape['name']}' uses {font_max}pt text — very large, consider reducing for balance",
            "shape_index": shape["shape_index"],
            "font_size": font_max
        })

    return issues


def check_empty_text_box(shape):
    """Check if a text frame exists but has no content."""
    issues = []

    if shape["has_text_frame"] and shape["text_length"] == 0:
        # Skip decorative auto_shapes (rectangles, ovals used as card backgrounds)
        if shape["shape_type"] in ("auto_shape", "freeform", "unknown"):
            return issues
        # Skip very small shapes
        if shape["width"] <= 0.5 or shape["height"] <= 0.2:
            return issues

        issues.append({
            "type": "empty_text_box",
            "severity": "warning",
            "message": f"Shape '{shape['name']}' has a text frame but no text (empty placeholder?)",
            "shape_index": shape["shape_index"]
        })

    return issues


def check_tiny_shape(shape):
    """Check if a visible text shape is too small to see."""
    issues = []
    MIN_DIM = 0.1
    if shape["has_text_frame"] and (shape["width"] < MIN_DIM or shape["height"] < MIN_DIM):
        if shape["shape_type"] not in ("auto_shape", "freeform"):
            issues.append({
                "type": "tiny_shape",
                "severity": "warning",
                "message": f"Text shape '{shape['name']}' is only {shape['width']}\" × {shape['height']}\" — likely invisible",
                "shape_index": shape["shape_index"]
            })
    return issues


def check_text_overflow(shape):
    """
    Simulate text wrapping to estimate whether text will overflow its bounding box.
    This is the KEY improvement over v1 — we now predict actual line count.
    """
    issues = []

    # Skip decorative ghost numbers
    if is_decorative_shape(shape):
        return issues

    if not shape.get("has_text_frame") or shape.get("text_length", 0) == 0:
        return issues

    # Only check fixed-size boxes (shapes that DON'T auto-resize their text)
    autosize = shape.get("autosize_mode", "NONE")
    if autosize not in ("NONE", "UNKNOWN", None):
        return issues  # auto-fit shapes self-correct

    box_w = shape["width"]
    box_h = shape["height"]
    if box_w <= 0 or box_h <= 0:
        return issues

    # Use max font size for worst-case scenario
    font_size = shape.get("font_size_max") or shape.get("font_size_min") or 12
    font_name = shape.get("font_name", "calibri")
    raw_text  = shape.get("raw_text", "") or ""

    if not raw_text:
        return issues

    # Estimate actual rendered height
    rendered_h = estimate_text_height(raw_text, font_size, box_w, font_name)

    if rendered_h > box_h:
        overflow_pct = round((rendered_h / box_h - 1.0) * 100, 1)
        issues.append({
            "type": "text_vertical_overflow",
            "severity": "error" if overflow_pct > 30 else "warning",
            "message": (
                f"Shape '{shape['name']}' text will overflow vertically by ~{overflow_pct}% "
                f"(estimated rendered height {round(rendered_h, 3)}\" > box height {round(box_h, 3)}\")"
            ),
            "shape_index": shape["shape_index"],
            "rendered_height": round(rendered_h, 3),
            "box_height": round(box_h, 3),
            "overflow_percent": overflow_pct,
            "font_size": font_size,
            "box_width": round(box_w, 3)
        })
    elif rendered_h > box_h * MAX_BODY_FILL_RATIO:
        fill_pct = round((rendered_h / box_h) * 100, 1)
        issues.append({
            "type": "text_near_overflow",
            "severity": "info",
            "message": (
                f"Shape '{shape['name']}' text fills {fill_pct}% of box height — "
                "very little breathing room"
            ),
            "shape_index": shape["shape_index"],
            "fill_percent": fill_pct
        })

    return issues


def check_horizontal_overflow(shape):
    """
    Check if any single word is likely wider than the box itself (unbreakable overflow).
    """
    issues = []

    if not shape.get("has_text_frame") or shape.get("text_length", 0) == 0:
        return issues

    raw_text  = shape.get("raw_text", "") or ""
    box_w     = shape["width"]
    font_size = shape.get("font_size_max") or 12
    font_name = shape.get("font_name", "calibri")

    if box_w <= 0 or not raw_text:
        return issues

    char_ratio          = FONT_AVG_CHAR_WIDTH_RATIO.get(font_key(font_name), 0.56)
    avg_char_width_pt   = font_size * char_ratio
    avg_char_width_inch = avg_char_width_pt / PT_PER_INCH
    chars_per_line      = box_w / avg_char_width_inch

    # Check longest word
    words = re.split(r'\s+', raw_text)
    longest = max((len(w) for w in words), default=0)
    if longest > chars_per_line * 1.1:
        issues.append({
            "type": "text_horizontal_overflow",
            "severity": "warning",
            "message": (
                f"Shape '{shape['name']}' contains a word of {longest} chars that may be "
                f"wider than its {round(box_w, 2)}\" box at {font_size}pt"
            ),
            "shape_index": shape["shape_index"],
            "longest_word_chars": longest,
            "chars_per_line_estimate": round(chars_per_line, 1)
        })

    return issues


def is_decorative_shape(shape):
    """Check if a shape is purely decorative and should be skipped in overlap/overflow checks.
    Decorative shapes include ghost section numbers (85% transparent, 160pt+) and
    shapes with 'ghost' in their name.
    """
    name = (shape.get("name") or "").lower()
    if "ghost" in name:
        return True
    # Also detect by extreme font size + high transparency (ghost section numbers)
    font_max = shape.get("font_size_max") or 0
    if font_max and font_max >= 100:
        return True
    return False


def check_overlaps(shapes):
    """Check for overlapping text-bearing shapes."""
    issues = []

    text_shapes = [s for s in shapes if s.get("has_text_frame") and s.get("text_length", 0) > 0]
    # Filter out decorative shapes (ghost numbers, etc.) from overlap checks
    text_shapes = [s for s in text_shapes if not is_decorative_shape(s)]

    for i in range(len(text_shapes)):
        for j in range(i + 1, len(text_shapes)):
            a = text_shapes[i]
            b = text_shapes[j]

            overlap = compute_overlap_area(a, b)
            if overlap <= 0:
                continue

            area_a = compute_shape_area(a)
            area_b = compute_shape_area(b)
            smaller = min(area_a, area_b)
            if smaller <= 0:
                continue

            pct = overlap / smaller

            if pct > OVERLAP_ERROR:
                issues.append({
                    "type": "text_overlap",
                    "severity": "error",
                    "message": f"Text shapes '{a['name']}' and '{b['name']}' overlap by {round(pct*100)}% — severe collision",
                    "shape_indices": [a["shape_index"], b["shape_index"]],
                    "overlap_percent": round(pct * 100)
                })
            elif pct > OVERLAP_THRESHOLD:
                issues.append({
                    "type": "text_overlap",
                    "severity": "warning",
                    "message": f"Text shapes '{a['name']}' and '{b['name']}' overlap by {round(pct*100)}%",
                    "shape_indices": [a["shape_index"], b["shape_index"]],
                    "overlap_percent": round(pct * 100)
                })

    return issues


def check_layout_zones(shapes, slide_h):
    """
    Verify that content respects layout zones:
    - Title text should be in the title zone (y < TITLE_ZONE_BOTTOM)
    - Large body blocks should not creep into the footer
    - Footers should only have small/metadata text
    """
    issues = []

    for shape in shapes:
        if not shape.get("has_text_frame") or shape.get("text_length", 0) == 0:
            continue

        font_max = shape.get("font_size_max") or 12
        top      = shape["top"]
        bottom   = shape["bottom"]

        # Title-sized text appearing in the body zone (not in title zone) — may be misplaced
        if font_max >= MIN_TITLE_FONT and top > TITLE_ZONE_BOTTOM + 0.5:
            issues.append({
                "type": "title_text_in_body_zone",
                "severity": "info",
                "message": (
                    f"Shape '{shape['name']}' has large text ({font_max}pt) but is placed "
                    f"in the body zone (y={round(top, 2)}\"). Intentional?"
                ),
                "shape_index": shape["shape_index"]
            })

        # Substantial body text bleeding into footer
        if top > FOOTER_ZONE_Y and shape.get("text_length", 0) > 30:
            issues.append({
                "type": "content_in_footer",
                "severity": "warning",
                "message": (
                    f"Shape '{shape['name']}' ({shape['text_length']} chars) is in the footer zone "
                    f"(y={round(top, 2)}\" > {FOOTER_ZONE_Y}\")"
                ),
                "shape_index": shape["shape_index"]
            })

    return issues


def check_whitespace_balance(shapes, slide_w, slide_h):
    """
    Verify that content is distributed across the slide.
    Uses a 2×2 quadrant analysis and center-of-mass for text weight.
    """
    issues = []

    text_shapes = [s for s in shapes if s.get("has_text_frame") and s.get("text_length", 0) > 5]
    if len(text_shapes) < 2:
        return issues

    total_weight = 0
    weighted_x   = 0
    weighted_y   = 0
    total_area   = 0.0

    # Quadrant fill (tl, tr, bl, br)
    quadrant_fill = [0.0, 0.0, 0.0, 0.0]

    mid_x = slide_w / 2
    mid_y = slide_h / 2

    for s in text_shapes:
        weight    = s["text_length"]
        center_x  = s["left"] + s["width"] / 2
        center_y  = s["top"]  + s["height"] / 2
        weighted_x += center_x * weight
        weighted_y += center_y * weight
        total_weight += weight
        total_area   += s["width"] * s["height"]

        q = (1 if center_x > mid_x else 0) + (2 if center_y > mid_y else 0)
        quadrant_fill[q] += s["width"] * s["height"]

    if total_weight == 0:
        return issues

    com_x   = weighted_x / total_weight
    com_y   = weighted_y / total_weight
    x_ratio = com_x / slide_w
    y_ratio = com_y / slide_h

    if abs(x_ratio - 0.5) > BALANCE_X_SKEW_THRESHOLD:
        side = "left" if x_ratio < 0.5 else "right"
        issues.append({
            "type": "unbalanced_horizontal",
            "severity": "warning",
            "message": (
                f"Content is heavily {side}-weighted (center of mass at {round(x_ratio*100)}% "
                f"horizontal). The slide will look unbalanced."
            ),
            "center_of_mass_x_pct": round(x_ratio * 100)
        })

    # Check if nearly all content is in top half (very bottom-heavy empty)
    top_fill    = quadrant_fill[0] + quadrant_fill[1]
    bottom_fill = quadrant_fill[2] + quadrant_fill[3]
    if bottom_fill > 0 and top_fill / (bottom_fill + top_fill) > 0.85:
        issues.append({
            "type": "top_heavy_layout",
            "severity": "info",
            "message": "Almost all text content is in the top half of the slide — large empty area at the bottom.",
            "top_fill_pct": round(top_fill / (top_fill + bottom_fill) * 100)
        })

    # Overall fill ratio (how much of the slide area is occupied by text shapes)
    total_slide_area  = slide_w * slide_h
    fill_ratio        = total_area / total_slide_area
    if fill_ratio < MIN_CONTENT_FILL_RATIO:
        issues.append({
            "type": "slide_underutilised",
            "severity": "info",
            "message": (
                f"Text content occupies only {round(fill_ratio*100, 1)}% of slide area — "
                "the slide may look empty."
            ),
            "fill_ratio": round(fill_ratio, 3)
        })
    elif fill_ratio > MAX_CONTENT_FILL_RATIO:
        issues.append({
            "type": "slide_overcrowded",
            "severity": "warning",
            "message": (
                f"Text content occupies {round(fill_ratio*100, 1)}% of slide area — "
                "the slide may feel cluttered."
            ),
            "fill_ratio": round(fill_ratio, 3)
        })

    return issues


def check_colour_contrast(shape):
    """
    Check WCAG colour contrast between foreground (font colour) and
    background (shape fill colour).
    """
    issues = []

    if not shape.get("has_text_frame") or shape.get("text_length", 0) == 0:
        return issues

    fg_hex = shape.get("font_color")
    bg_hex = shape.get("fill_color")

    if not fg_hex or not bg_hex:
        return issues  # Can't check without both colours

    fg_rgb = hex_to_rgb(fg_hex)
    bg_rgb = hex_to_rgb(bg_hex)

    if fg_rgb is None or bg_rgb is None:
        return issues

    lum_fg = relative_luminance(fg_rgb)
    lum_bg = relative_luminance(bg_rgb)
    ratio  = contrast_ratio(lum_fg, lum_bg)

    if ratio is None:
        return issues

    ratio = round(ratio, 2)
    font_size = shape.get("font_size_min") or 12
    is_large_text = font_size >= 18 or (font_size >= 14 and shape.get("is_bold"))
    required = CONTRAST_AA_LARGE if is_large_text else CONTRAST_AA_NORMAL

    if ratio < required:
        issues.append({
            "type": "low_contrast",
            "severity": "error" if ratio < 2.0 else "warning",
            "message": (
                f"Shape '{shape['name']}' has a colour contrast ratio of {ratio}:1 "
                f"(required WCAG AA: {required}:1 for {'large' if is_large_text else 'normal'} text)"
            ),
            "shape_index": shape["shape_index"],
            "contrast_ratio": ratio,
            "fg_color": fg_hex,
            "bg_color": bg_hex,
            "required_ratio": required
        })

    return issues


def check_duplicate_text(shapes):
    """Detect identical text blocks appearing more than once on the same slide."""
    issues = []

    texts = []
    for s in shapes:
        if s.get("has_text_frame") and s.get("text_length", 0) > 10:
            raw = (s.get("raw_text") or "").strip().lower()
            if raw:
                texts.append((raw, s))

    seen = {}
    for raw, shape in texts:
        if raw in seen:
            issues.append({
                "type": "duplicate_text",
                "severity": "warning",
                "message": (
                    f"Shape '{shape['name']}' has text that is identical to '{seen[raw]['name']}' — "
                    "possible copy-paste error"
                ),
                "shape_index": shape["shape_index"]
            })
        else:
            seen[raw] = shape

    return issues


def check_image_aspect_ratio(shape):
    """Flag images with extreme aspect ratios (likely stretched/squished)."""
    issues = []

    if shape.get("shape_type") != "image":
        return issues

    w = shape["width"]
    h = shape["height"]
    if h <= 0:
        return issues

    ratio = w / h
    if ratio > 5.0 or ratio < 0.2:
        issues.append({
            "type": "extreme_image_aspect",
            "severity": "warning",
            "message": (
                f"Image '{shape['name']}' has an extreme aspect ratio of {round(ratio, 2)}:1 "
                "— it may be stretched or squished."
            ),
            "shape_index": shape["shape_index"],
            "aspect_ratio": round(ratio, 2)
        })

    return issues


def check_spacing_consistency(shapes):
    """
    Warn if elements of the same approximate size have very inconsistent gaps,
    which can break visual rhythm.
    """
    issues = []

    # Find all text boxes with width > 1.5" (body content, not tiny labels)
    body_shapes = sorted(
        [s for s in shapes if s.get("has_text_frame") and s["width"] > 1.5],
        key=lambda s: s["top"]
    )

    if len(body_shapes) < 3:
        return issues

    gaps = []
    for i in range(1, len(body_shapes)):
        gap = body_shapes[i]["top"] - body_shapes[i-1]["bottom"]
        if gap > 0:
            gaps.append(gap)

    if not gaps:
        return issues

    avg_gap  = sum(gaps) / len(gaps)
    variance = sum((g - avg_gap) ** 2 for g in gaps) / len(gaps)
    std_dev  = math.sqrt(variance)

    if std_dev > avg_gap * 0.6 and len(gaps) >= 2:
        issues.append({
            "type": "inconsistent_vertical_spacing",
            "severity": "info",
            "message": (
                f"Vertical spacing between body elements is inconsistent "
                f"(avg gap={round(avg_gap*100)/100}\", std dev={round(std_dev*100)/100}\"). "
                "This can make the slide feel disorganised."
            ),
            "avg_gap_inches": round(avg_gap, 3),
            "std_dev_inches": round(std_dev, 3)
        })

    return issues


def check_font_count(shapes):
    """Warn if too many different font families are used on one slide."""
    issues = []

    font_names = set()
    for s in shapes:
        fn = s.get("font_name")
        if fn:
            font_names.add(fn.lower().strip())

    if len(font_names) > 3:
        issues.append({
            "type": "too_many_fonts",
            "severity": "warning",
            "message": (
                f"Slide uses {len(font_names)} different font families "
                f"({', '.join(sorted(font_names)[:5])}). "
                "Limit to 2 for a professional look."
            ),
            "font_count": len(font_names),
            "fonts": list(sorted(font_names))
        })

    return issues


# ─── Slide-level review ───────────────────────────────────────────────────────

def review_slide(slide_data, slide_w, slide_h):
    """Run all structural checks on a single slide."""
    shapes     = slide_data.get("shapes_geometry", [])
    all_issues = []

    # Per-shape checks
    for shape in shapes:
        all_issues.extend(check_out_of_bounds(shape, slide_w, slide_h))
        all_issues.extend(check_font_size(shape))
        all_issues.extend(check_tiny_shape(shape))
        all_issues.extend(check_empty_text_box(shape))
        all_issues.extend(check_text_overflow(shape))
        all_issues.extend(check_horizontal_overflow(shape))
        all_issues.extend(check_layout_zones(shapes, slide_h))
        all_issues.extend(check_colour_contrast(shape))
        all_issues.extend(check_image_aspect_ratio(shape))

    # Cross-shape checks
    all_issues.extend(check_overlaps(shapes))
    all_issues.extend(check_whitespace_balance(shapes, slide_w, slide_h))
    all_issues.extend(check_duplicate_text(shapes))
    all_issues.extend(check_spacing_consistency(shapes))
    all_issues.extend(check_font_count(shapes))

    # Deduplicate issues with identical messages (layout_zones runs per shape, can repeat)
    seen_msgs = set()
    deduped   = []
    for issue in all_issues:
        key = (issue["type"], issue.get("message", ""))
        if key not in seen_msgs:
            seen_msgs.add(key)
            deduped.append(issue)
    all_issues = deduped

    # Compute score
    score         = 10.0
    error_count   = 0
    warning_count = 0
    info_count    = 0

    for issue in all_issues:
        if issue["severity"] == "error":
            score -= DEDUCT_ERROR
            error_count += 1
        elif issue["severity"] == "warning":
            score -= DEDUCT_WARNING
            warning_count += 1
        elif issue["severity"] == "info":
            score -= DEDUCT_INFO
            info_count += 1

    score = max(0.0, round(score, 2))

    return {
        "slide_number":     slide_data["slide_number"],
        "structural_score": score,
        "pass":             score >= PASS_THRESHOLD,
        "error_count":      error_count,
        "warning_count":    warning_count,
        "info_count":       info_count,
        "issues":           all_issues
    }


# ─── Entry point ─────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) >= 2:
        with open(sys.argv[1], 'r') as f:
            data = json.load(f)
    else:
        data = json.load(sys.stdin)

    slide_w = data.get("slide_width_inches",  SLIDE_WIDTH)
    slide_h = data.get("slide_height_inches", SLIDE_HEIGHT)

    slide_reviews  = []
    total_score    = 0
    total_errors   = 0
    total_warnings = 0
    passed_count   = 0

    for slide_data in data.get("slides", []):
        review = review_slide(slide_data, slide_w, slide_h)
        slide_reviews.append(review)
        total_score    += review["structural_score"]
        total_errors   += review["error_count"]
        total_warnings += review["warning_count"]
        if review["pass"]:
            passed_count += 1

    slide_count   = len(slide_reviews)
    overall_score = round(total_score / slide_count, 2) if slide_count > 0 else 10.0

    output = {
        "slides":                  slide_reviews,
        "overall_structural_score": overall_score,
        "passed_count":            passed_count,
        "failed_count":            slide_count - passed_count,
        "total_errors":            total_errors,
        "total_warnings":          total_warnings,
        "pass_threshold":          PASS_THRESHOLD
    }

    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
