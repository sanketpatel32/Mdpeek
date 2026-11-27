use std::path::{Path, PathBuf};

use gpui_kit::{Bounds, Hsla, Path as GpuiPath, PathBuilder, Pixels, Point, px};

#[derive(Clone, Debug)]
pub struct AnnotationStroke {
    pub points: Vec<(f32, f32)>,
    pub color: Hsla,
    /// Stroke width as a fraction of the annotated image width.
    pub size: f32,
}

impl AnnotationStroke {
    pub fn new(point: (f32, f32), color: Hsla, size: f32) -> Self {
        Self {
            points: vec![point],
            color,
            size,
        }
    }
}

pub fn normalized_point(position: Point<Pixels>, bounds: Bounds<Pixels>) -> (f32, f32) {
    let width = f32::from(bounds.size.width).max(1.0);
    let height = f32::from(bounds.size.height).max(1.0);
    (
        (f32::from(position.x - bounds.origin.x) / width).clamp(0.0, 1.0),
        (f32::from(position.y - bounds.origin.y) / height).clamp(0.0, 1.0),
    )
}

pub fn stroke_path(stroke: &AnnotationStroke, bounds: Bounds<Pixels>) -> Option<GpuiPath> {
    if stroke.points.len() < 2 {
        return None;
    }
    let width = f32::from(bounds.size.width);
    let height = f32::from(bounds.size.height);
    let mut builder = PathBuilder::stroke(px((stroke.size * width).max(1.0)));
    let first = stroke.points[0];
    builder.move_to(Point::new(
        bounds.origin.x + px(first.0 * width),
        bounds.origin.y + px(first.1 * height),
    ));
    for point in stroke.points.iter().skip(1) {
        builder.line_to(Point::new(
            bounds.origin.x + px(point.0 * width),
            bounds.origin.y + px(point.1 * height),
        ));
    }
    builder.build().ok()
}

fn rgba8(color: Hsla) -> image::Rgba<u8> {
    let color = color.to_rgb();
    image::Rgba([
        (color.r.clamp(0.0, 1.0) * 255.0).round() as u8,
        (color.g.clamp(0.0, 1.0) * 255.0).round() as u8,
        (color.b.clamp(0.0, 1.0) * 255.0).round() as u8,
        (color.a.clamp(0.0, 1.0) * 255.0).round() as u8,
    ])
}

fn blend_pixel(image: &mut image::RgbaImage, x: i32, y: i32, color: image::Rgba<u8>) {
    if x < 0 || y < 0 || x >= image.width() as i32 || y >= image.height() as i32 {
        return;
    }
    let alpha = color.0[3] as f32 / 255.0;
    let pixel = image.get_pixel_mut(x as u32, y as u32);
    for channel in 0..3 {
        pixel.0[channel] = ((color.0[channel] as f32 * alpha)
            + (pixel.0[channel] as f32 * (1.0 - alpha)))
            .round() as u8;
    }
    pixel.0[3] = 255;
}

fn draw_disc(image: &mut image::RgbaImage, x: f32, y: f32, radius: f32, color: image::Rgba<u8>) {
    let radius = radius.max(0.5);
    let min_x = (x - radius).floor() as i32;
    let max_x = (x + radius).ceil() as i32;
    let min_y = (y - radius).floor() as i32;
    let max_y = (y + radius).ceil() as i32;
    for py in min_y..=max_y {
        for px in min_x..=max_x {
            let dx = px as f32 - x;
            let dy = py as f32 - y;
            if dx * dx + dy * dy <= radius * radius {
                blend_pixel(image, px, py, color);
            }
        }
    }
}

fn draw_line(
    image: &mut image::RgbaImage,
    start: (f32, f32),
    end: (f32, f32),
    width: f32,
    color: image::Rgba<u8>,
) {
    let distance = ((end.0 - start.0).powi(2) + (end.1 - start.1).powi(2)).sqrt();
    let steps = (distance.ceil() as usize).max(1);
    let radius = width / 2.0;
    for step in 0..=steps {
        let progress = step as f32 / steps as f32;
        let x = start.0 + (end.0 - start.0) * progress;
        let y = start.1 + (end.1 - start.1) * progress;
        draw_disc(image, x, y, radius, color);
    }
}

fn output_path(source: &Path) -> Option<PathBuf> {
    let parent = source.parent().unwrap_or_else(|| Path::new("."));
    let stem = source
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("image");
    for index in 0..100 {
        let suffix = if index == 0 {
            String::new()
        } else {
            format!("-{index}")
        };
        let candidate = parent.join(format!("{stem}-annotated{suffix}.png"));
        if !candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

pub fn save_annotated_png(source: &Path, strokes: &[AnnotationStroke]) -> Result<PathBuf, String> {
    if strokes.is_empty() {
        return Err("Draw at least one annotation before saving".to_string());
    }
    let mut image = image::open(source)
        .map_err(|error| format!("Could not decode image for annotation: {error}"))?
        .to_rgba8();
    let image_width = image.width() as f32;
    let image_height = image.height() as f32;

    for stroke in strokes {
        if stroke.points.len() < 2 {
            continue;
        }
        let color = rgba8(stroke.color);
        let width = (stroke.size * image_width).max(1.0);
        for pair in stroke.points.windows(2) {
            let start = (pair[0].0 * image_width, pair[0].1 * image_height);
            let end = (pair[1].0 * image_width, pair[1].1 * image_height);
            draw_line(&mut image, start, end, width, color);
        }
    }

    let Some(output) = output_path(source) else {
        return Err(
            "Too many annotated copies already exist; remove or rename one before saving"
                .to_string(),
        );
    };
    image
        .save(&output)
        .map_err(|error| format!("Could not save annotated PNG: {error}"))?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::{AnnotationStroke, save_annotated_png};
    use gpui_kit::{Hsla, hsla};

    #[test]
    fn saves_annotated_png_without_overwriting_source() {
        let directory =
            std::env::temp_dir().join(format!("mdpeek-annotation-test-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let source = directory.join("source.png");
        image::RgbaImage::from_pixel(8, 8, image::Rgba([255, 255, 255, 255]))
            .save(&source)
            .unwrap();
        let stroke = AnnotationStroke::new((0.0, 0.0), Hsla::red(), 0.2);
        let mut stroke = stroke;
        stroke.points.push((1.0, 1.0));
        let output = save_annotated_png(&source, &[stroke]).unwrap();
        assert_ne!(output, source);
        assert!(output.exists());
        assert_eq!(image::image_dimensions(&output).unwrap(), (8, 8));
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn empty_annotations_are_rejected() {
        let error = save_annotated_png(Path::new("missing.png"), &[]).unwrap_err();
        assert!(error.contains("Draw at least one"));
    }

    use std::path::Path;

    #[test]
    fn hsla_red_is_opaque_red() {
        let color = hsla(0.0, 1.0, 0.5, 1.0).to_rgb();
        assert!(color.r > 0.99);
        assert!(color.g < 0.01);
    }
}
