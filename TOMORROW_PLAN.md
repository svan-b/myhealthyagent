# Day 9 Quick Start Guide

## File Structure Prepared
- `/app/components/mobile/` - New mobile components
- `/app/components/legacy/` - Day 8 backups
- `/app/styles/mobile.css` - Mobile utilities (not imported yet)
- Feature flag in page.tsx (currently FALSE)

## Morning Setup (5 min)
1. Set USE_NEW_MOBILE_UI = true in page.tsx
2. Import mobile.css in layout.tsx
3. Work only in /mobile/ components

## Development Order
1. QuickLogFlow.tsx - Build 3-screen flow
2. SeverityPicker.tsx - Replace broken slider
3. Test on iPhone after each screen
4. Only touch LogTab.tsx after new version works

## Safety Rules
- Don't delete /legacy/ folder until Day 10
- Test with feature flag before removing old code
- Keep History, Charts, Meds tabs unchanged

## Test Commands
```bash
# Check it builds
npm run build

# Test 7-second flow
npm run test:e2e -- --grep "7-second"

# Deploy for iPhone test
git push && vercel
```

## Success Metrics
- [ ] 7-second flow passes
- [ ] Selection states visible
- [ ] No horizontal scroll
- [ ] Works with one thumb