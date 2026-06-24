#!/usr/bin/env python3
"""
structural_review.py — Sales Brain PPT Visual/Structural Reviewer

Reads the enhanced JSON output from extract_slides.py (with shapes_geometry)
and runs rule-based structural checks for layout quality.

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


# ─── Constants ────────────────────────────────────────────────────────────────
SLIDE_WIDTH = 10.0      # Standard 16:9 slide width in inches
SLIDE_HEIGHT = 5.625    # Standard 16:9 slide height in inches
PASS_THRESHOLD = 7.0    # Slide passes if structural score >= 7.0/10

# Scoring deductions
DEDUCT_ERROR = 1.5
DEDUCT_WARNING = 0.5
DEDUCT_INFO = 0.1

# Check thresholds
MIN_FONT_SIZE = 8          # Minimum readable font size (pt)
MIN_SHAPE_DIMENSION = 0.1  # Minimum shape width/height (inches) — below this is invisible
OVERLAP_THRESHOLD = 0.20   # Two text shapes overlapping > 20% area = warning
FOOTER_ZONE_Y = 4.85       # Y position below which is "footer zone"
TEXT_DENSITY_LIMIT = 1.2    # Estimated chars per sq-inch capacity (conservative)

# Approximate characters that fit per square inch at various font sizes
# Based on Calibri font metrics: avg char width ≈ fontSize * 0.55pt, line height ≈ fontSize * 1.2
CHARS_PER_SQ_INCH_BY_FONT = {
    8: 85,
    9: 70,
    10: 58,
    11: 48,
    12: 40,
    13: 34,
    14: 28,
    16: 22,
    18: 17,
    20: 13,
    24: 9,
    28: 7,
    32: 5,
    36: 4,
    40: 3,
    48: 2,
}


def get_chars_per_sq_inch(font_size):
    """Estimate max characters per square inch for a given font size."""
    if font_size is None:
        font_size = 12  # default assumption
    
    # Find closest font size in our lookup
    closest = min(CHARS_PER_SQ_INCH_BY_FONT.keys(), key=lambda k: abs(k - font_size))
    return CHARS_PER_SQ_INCH_BY_FONT[closest]


def compute_overlap_area(shape_a, shape_b):
    """Compute overlapping area between two shapes in square inches."""
    # Calculate intersection rectangle
    x_overlap = max(0, min(shape_a["right"], shape_b["right"]) - max(shape_a["left"], shape_b["left"]))
    y_overlap = max(0, min(shape_a["bottom"], shape_b["bottom"]) - max(shape_a["top"], shape_b["top"]))
    return x_overlap * y_overlap


def compute_shape_area(shape):
    """Compute area of a shape in square inches."""
    return shape["width"] * shape["height"]


def check_out_of_bounds(shape, slide_w, slide_h):
    """Check if a shape extends beyond the slide canvas."""
    issues = []
    
    # Allow small tolerance (0.5 inches) for decorative bleeds
    tolerance = 0.5
    
    if shape["right"] > slide_w + tolerance:
        overshoot = round(shape["right"] - slide_w, 2)
        issues.append({
            "type": "out_of_bounds_right",
            "severity": "warning" if overshoot < 1.5 else "error",
            "message": f"Shape '{shape['name']}' extends {overshoot}\" past right edge",
            "shape_index": shape["shape_index"],
            "overshoot_inches": overshoot
        })
    
    if shape["bottom"] > slide_h + tolerance:
        overshoot = round(shape["bottom"] - slide_h, 2)
        issues.append({
            "type": "out_of_bounds_bottom",
            "severity": "warning" if overshoot < 1.0 else "error",
            "message": f"Shape '{shape['name']}' extends {overshoot}\" past bottom edge",
            "shape_index": shape["shape_index"],
            "overshoot_inches": overshoot
        })
    
    # Negative positions (bleeds off left/top) — usually intentional decorative shapes
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
    """Check if any text is too small to read."""
    issues = []
    
    if shape["font_size_min"] is not None and shape["font_size_min"] < MIN_FONT_SIZE:
        issues.append({
            "type": "font_too_small",
            "severity": "warning",
            "message": f"Shape '{shape['name']}' has {shape['font_size_min']}pt text (min readable: {MIN_FONT_SIZE}pt)",
            "shape_index": shape["shape_index"],
            "font_size": shape["font_size_min"]
        })
    
    return issues


def check_tiny_shape(shape):
    """Check if a shape is too small to be visible."""
    issues = []
    
    # Skip decorative shapes (lines, accents) which are intentionally thin
    if shape["shape_type"] in ("auto_shape", "freeform"):
        return issues
    
    if shape["has_text_frame"] and (shape["width"] < MIN_SHAPE_DIMENSION or shape["height"] < MIN_SHAPE_DIMENSION):
        issues.append({
            "type": "tiny_shape",
            "severity": "warning",
            "message": f"Text shape '{shape['name']}' is only {shape['width']}\" × {shape['height']}\" — likely invisible",
            "shape_index": shape["shape_index"]
        })
    
    return issues


def check_empty_text_box(shape):
    """Check if a text frame exists but has no content."""
    issues = []
    
    if shape["has_text_frame"] and shape["text_length"] == 0:
        # Ignore decorative auto_shapes (rectangles, ovals used as card backgrounds)
        # In pptxgenjs, addShape() creates auto_shapes with empty text frames by design
        if shape["shape_type"] in ("auto_shape", "freeform", "unknown"):
            return issues
        
        # Ignore very small shapes (likely decorative spacers or accent bars)
        if shape["width"] <= 0.5 or shape["height"] <= 0.2:
            return issues
        
        issues.append({
            "type": "empty_text_box",
            "severity": "warning",
            "message": f"Shape '{shape['name']}' has a text frame but no text (placeholder?)",
            "shape_index": shape["shape_index"]
        })
    
    return issues


def check_text_overflow(shape):
    """Estimate if text will overflow the shape's bounding box."""
    issues = []
    
    if not shape["has_text_frame"] or shape["text_length"] == 0:
        return issues
    
    # Only check shapes with fixed size (NONE autosize = text doesn't auto-shrink)
    if shape["autosize_mode"] not in ("NONE", "UNKNOWN", None):
        return issues
    
    area = shape["width"] * shape["height"]
    if area <= 0:
        return issues
    
    # Estimate capacity based on font size
    font_size = shape["font_size_max"] or shape["font_size_min"] or 12
    chars_per_sq_inch = get_chars_per_sq_inch(font_size)
    estimated_capacity = area * chars_per_sq_inch
    
    text_len = shape["text_length"]
    fill_ratio = text_len / max(estimated_capacity, 1)
    
    if fill_ratio > TEXT_DENSITY_LIMIT:
        severity = "error" if fill_ratio > 2.0 else "warning"
        issues.append({
            "type": "text_overflow",
            "severity": severity,
            "message": f"Shape '{shape['name']}' has ~{text_len} chars at {font_size}pt in {round(area, 2)} sq\" — estimated {round(fill_ratio * 100)}% fill (likely overflows)",
            "shape_index": shape["shape_index"],
            "text_length": text_len,
            "estimated_capacity": round(estimated_capacity),
            "fill_ratio": round(fill_ratio, 2)
        })
    
    return issues


def check_overlaps(shapes):
    """Check for overlapping text-bearing shapes."""
    issues = []
    
    # Only check text shapes (decorative shapes are allowed to overlap)
    text_shapes = [s for s in shapes if s["has_text_frame"] and s["text_length"] > 0]
    
    for i in range(len(text_shapes)):
        for j in range(i + 1, len(text_shapes)):
            a = text_shapes[i]
            b = text_shapes[j]
            
            overlap_area = compute_overlap_area(a, b)
            if overlap_area <= 0:
                continue
            
            area_a = compute_shape_area(a)
            area_b = compute_shape_area(b)
            smaller_area = min(area_a, area_b)
            
            if smaller_area <= 0:
                continue
            
            overlap_pct = overlap_area / smaller_area
            
            if overlap_pct > OVERLAP_THRESHOLD:
                issues.append({
                    "type": "text_overlap",
                    "severity": "warning" if overlap_pct < 0.5 else "error",
                    "message": f"Text shapes '{a['name']}' and '{b['name']}' overlap by {round(overlap_pct * 100)}%",
                    "shape_indices": [a["shape_index"], b["shape_index"]],
                    "overlap_percent": round(overlap_pct * 100)
                })
    
    return issues


def check_content_in_footer(shape):
    """Check if meaningful content is placed in the footer zone."""
    issues = []
    
    # If shape is in footer zone and has substantial text, flag it
    if shape["top"] > FOOTER_ZONE_Y and shape["has_text_frame"] and shape["text_length"] > 30:
        issues.append({
            "type": "content_in_footer",
            "severity": "info",
            "message": f"Shape '{shape['name']}' with {shape['text_length']} chars is in footer zone (y={shape['top']}\")",
            "shape_index": shape["shape_index"]
        })
    
    return issues


def check_whitespace_balance(shapes, slide_w, slide_h):
    """Check if content is well-distributed across the slide."""
    issues = []
    
    # Only analyze text shapes
    text_shapes = [s for s in shapes if s["has_text_frame"] and s["text_length"] > 5]
    if len(text_shapes) < 2:
        return issues
    
    # Calculate center of mass of text content
    total_weight = 0
    weighted_x = 0
    weighted_y = 0
    
    for s in text_shapes:
        weight = s["text_length"]
        center_x = s["left"] + s["width"] / 2
        center_y = s["top"] + s["height"] / 2
        weighted_x += center_x * weight
        weighted_y += center_y * weight
        total_weight += weight
    
    if total_weight == 0:
        return issues
    
    com_x = weighted_x / total_weight
    com_y = weighted_y / total_weight
    
    # Check if content is heavily skewed to one side
    x_ratio = com_x / slide_w  # 0.5 = centered
    y_ratio = com_y / slide_h
    
    if x_ratio < 0.2 or x_ratio > 0.8:
        issues.append({
            "type": "unbalanced_horizontal",
            "severity": "info",
            "message": f"Content is heavily {'left' if x_ratio < 0.3 else 'right'}-weighted (center of mass at {round(x_ratio * 100)}% horizontal)",
            "center_of_mass_x_pct": round(x_ratio * 100)
        })
    
    return issues


def review_slide(slide_data, slide_w, slide_h):
    """Run all structural checks on a single slide."""
    shapes = slide_data.get("shapes_geometry", [])
    all_issues = []
    
    for shape in shapes:
        all_issues.extend(check_out_of_bounds(shape, slide_w, slide_h))
        all_issues.extend(check_font_size(shape))
        all_issues.extend(check_tiny_shape(shape))
        all_issues.extend(check_empty_text_box(shape))
        all_issues.extend(check_text_overflow(shape))
        all_issues.extend(check_content_in_footer(shape))
    
    # Cross-shape checks
    all_issues.extend(check_overlaps(shapes))
    all_issues.extend(check_whitespace_balance(shapes, slide_w, slide_h))
    
    # Compute score
    score = 10.0
    error_count = 0
    warning_count = 0
    info_count = 0
    
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
    
    score = max(0, round(score, 2))
    
    return {
        "slide_number": slide_data["slide_number"],
        "structural_score": score,
        "pass": score >= PASS_THRESHOLD,
        "error_count": error_count,
        "warning_count": warning_count,
        "info_count": info_count,
        "issues": all_issues
    }


def main():
    # Read from stdin or file argument
    if len(sys.argv) >= 2:
        with open(sys.argv[1], 'r') as f:
            data = json.load(f)
    else:
        data = json.load(sys.stdin)
    
    slide_w = data.get("slide_width_inches", SLIDE_WIDTH)
    slide_h = data.get("slide_height_inches", SLIDE_HEIGHT)
    
    slide_reviews = []
    total_score = 0
    total_errors = 0
    total_warnings = 0
    passed_count = 0
    
    for slide_data in data.get("slides", []):
        review = review_slide(slide_data, slide_w, slide_h)
        slide_reviews.append(review)
        total_score += review["structural_score"]
        total_errors += review["error_count"]
        total_warnings += review["warning_count"]
        if review["pass"]:
            passed_count += 1
    
    slide_count = len(slide_reviews)
    overall_score = round(total_score / slide_count, 2) if slide_count > 0 else 10.0
    
    output = {
        "slides": slide_reviews,
        "overall_structural_score": overall_score,
        "passed_count": passed_count,
        "failed_count": slide_count - passed_count,
        "total_errors": total_errors,
        "total_warnings": total_warnings,
        "pass_threshold": PASS_THRESHOLD
    }
    
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
