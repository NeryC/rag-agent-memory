from fpdf import FPDF
pdf = FPDF()
pdf.add_page()
pdf.set_font('Helvetica', size=12)
pdf.cell(0, 10, 'Artificial Intelligence: A Technical Overview', new_x='LMARGIN', new_y='NEXT')
pdf.ln(5)
texts = [
    'Artificial intelligence (AI) refers to the simulation of human intelligence processes by computer systems.',
    'Machine learning is a subset of AI that enables systems to automatically learn and improve from experience.',
    'Deep learning uses neural networks with many layers to analyze patterns in data at multiple levels of abstraction.',
    'Natural language processing (NLP) allows computers to understand and generate human language.',
]
for t in texts:
    pdf.multi_cell(0, 8, t)
    pdf.ln(2)
pdf.output('ai-overview-v2.pdf')
print('Generated ai-overview-v2.pdf')
