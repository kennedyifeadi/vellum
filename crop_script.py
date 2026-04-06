from PIL import Image
import os

def process_favicon():
    try:
        # Load the original image
        img = Image.open('public/vellum.png')
        img = img.convert("RGBA")
        
        # Find the bounding box of non-transparent areas
        alpha = img.split()[-1]
        bbox = alpha.getbbox()
        
        if bbox:
            print(f"Original size: {img.size}, bounding box: {bbox}")
            cropped = img.crop(bbox)
            
            width, height = cropped.size
            # Make it square
            size = max(width, height)
            
            # Allow a very slight padding (e.g., 5%) so it's not strictly touching the edge
            padding = int(size * 0.05)
            new_size = size + padding * 2
            
            square_img = Image.new('RGBA', (new_size, new_size), (0, 0, 0, 0))
            offset_x = (new_size - width) // 2
            offset_y = (new_size - height) // 2
            
            square_img.paste(cropped, (offset_x, offset_y))
            
            # Save it
            square_img.save('app/favicon.ico', format='ICO', sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128)])
            print("Successfully cropped and saved to app/favicon.ico")
            
            # Also save as app/icon.png just in case for next.js app folder compatibility
            square_img.save('app/icon.png', format='PNG')
            print("Successfully saved to app/icon.png")
            return "Done"
        else:
            return "Could not find a bounding box"
    except Exception as e:
        return f"Error: {e}"

if __name__ == '__main__':
    print(process_favicon())
