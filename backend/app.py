from flask import Flask, request, jsonify
from flask_cors import CORS  # Enable CORS for React frontend
import requests
import google.generativeai as genai

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Configure Gemini API
GEMINI_API_KEY = ""
genai.configure(api_key=GEMINI_API_KEY)

# Configure YOU API
YOU_API_KEY = ""

def get_ai_snippets_for_query(query):
    """Fetch AI-generated snippets from YOU API for a given query."""
    headers = {"X-API-Key": YOU_API_KEY}
    params = {"query": query}
    response = requests.get(
        "https://api.ydc-index.io/search",
        params=params,
        headers=headers,
    )
    return response.json()

def extract_urls_from_response(response):
    """Extract URLs from the YOU API response."""
    urls = []
    if "hits" in response:
        for hit in response["hits"]:
            if "url" in hit:
                urls.append(hit["url"])
    return urls

def analyze_text_with_gemini(text):
    """Analyze text for accuracy using the Gemini API."""
    model = genai.GenerativeModel('gemini-pro')
    prompt = f"Is the following statement accurate? Provide a brief explanation. Statement: {text}"
    response = model.generate_content(prompt)
    return response.text

@app.route("/analyze", methods=["POST"])
def analyze():
    # Get the user's input from the request body
    data = request.get_json()
    user_input = data.get("statement")

    # Analyze the text with Gemini
    gemini_response = analyze_text_with_gemini(user_input)

    # Fetch sources with YOU API if the text is flagged as inaccurate
    if "not accurate" in gemini_response.lower() or "false" in gemini_response.lower():
        sources_response = get_ai_snippets_for_query(f"Provide sources for: {user_input}")
        urls = extract_urls_from_response(sources_response)
    else:
        urls = []

    # Return the results as JSON
    return jsonify({
        "statement": user_input,
        "analysis": gemini_response,
        "sources": urls
    })

if __name__ == "__main__":
    app.run(debug=True)
