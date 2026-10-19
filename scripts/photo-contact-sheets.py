from PIL import Image, ImageOps, ImageDraw
from pathlib import Path
root=Path('.local/commons/candidates')
keys=['golf','bmw','mercedes','audi','skoda','toyota','volvo','renault','porsche','tesla','fiat','subaru','bmwx','audix','toyotax','volvox','porschex']
for part in range(6):
    board=Image.new('RGB',(1600,900),'#eeeeee'); draw=ImageDraw.Draw(board)
    for row,key in enumerate(keys[part*3:part*3+3]):
        for col,path in enumerate(sorted(root.glob(key+'-*.jpg'))[:4]):
            im=ImageOps.contain(Image.open(path).convert('RGB'),(390,265))
            board.paste(im,(col*400,row*300+25));draw.text((col*400+8,row*300+5),path.stem,fill='black')
    board.save(f'.local/commons/contact-{part+1}.jpg')
