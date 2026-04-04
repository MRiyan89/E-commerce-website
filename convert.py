import docx
from reportlab.platypus import SimpleDocTemplate, Paragraph, ListFlowable, ListItem, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.pagesizes import letter

def process_doc(input_file, output_file):
    doc = docx.Document(input_file)
    pdf = SimpleDocTemplate(output_file, pagesize=letter,
                            rightMargin=72, leftMargin=72,
                            topMargin=72, bottomMargin=18)
    
    styles = getSampleStyleSheet()
    normal_style = styles['Normal']
    normal_style.fontSize = 11
    normal_style.leading = 14
    
    story = []
    
    list_items = []
    
    for para in doc.paragraphs:
        text = para.text.strip()
        if text:
            # We want to format like bullet points.
            # Convert text into a paragraph, add to our list
            p = Paragraph(text, normal_style)
            list_items.append(ListItem(p, leftIndent=15))
            
    if list_items:
        bullet_list = ListFlowable(
            list_items,
            bulletType='bullet',
            start='',   # not needed for bullet
            bulletFontName='Helvetica',
            bulletFontSize=11,
        )
        story.append(bullet_list)
        
    pdf.build(story)

if __name__ == "__main__":
    process_doc('Marketplace Backend Explanation.docx', 'Backend_Explanation.pdf')
