# Description
In the Netherlands, millions of people participate in corporate or friend "poules" 
for the Eredivisie, Formula 1, or major football tournaments via platforms like Scorito. 
However, people often struggle to make informed predictions because they don't want to dig through complex sports stats.

The Concept: A "Cheat Sheet" generator for casual pool participants.
How it works: A single-page dashboard where a user selects an upcoming Eredivisie match. 
The page uses a basic, hardcoded statistical formula (historical head-to-head, recent form, home/away advantage) to give a definitive "Optimized Pool Prediction" (e.g., Ajax vs. PSV: Predicted Score 1-2. Probability of Draw: 22%).
Why it’s in demand: It saves users time. Instead of analyzing stats themselves, 
they use your tool to quickly fill out their company Scorito pool. 
You don't need a live database for this initially; you can just hardcode data for the current season or use a free API.  
The challenge is data freshness. Hardcoded stats go stale fast, and if your predictions feel off, trust dies immediately. 
You'd want to hook into a free API (API-Football has a decent free tier) relatively quickly. 
But the core concept is "just tell me what to pick" 

