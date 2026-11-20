"""실거래로 후보를 추리는 순수 계산. 모델은 숫자와 순서를 바꾸지 않는다."""
import hashlib
from statistics import median
from tools.property import _norm, dong_of, parcel_of
from tools.property_move import income_price_ratio, capital_shortfall


def shortlist(rows, saved, *, net, pir, area_min, area_max, limit, home_value=0, peer_years=5, peer_min=3, per_district=None, ranking='relative'):
    groups = {}
    excluded_keys=set()
    for r in rows:
        if not area_min <= r['area'] <= area_max or not r.get('jibun') or r['price'] <= 0:
            continue
        excluded = False
        for c in saved:
            a = c.get('address') or {}
            if a.get('sigungu_code') != r['sigungu']:
                continue
            members = c.get('members') or [{'name': a.get('building') or c['name'], 'jibun': a.get('jibun', '')}]
            if any((_norm(m.get('name', '')) == _norm(r['name'])) or
                   (dong_of(m.get('jibun', '')) == r['dong'] and parcel_of(m.get('jibun', '')) == parcel_of(r['jibun'])) for m in members):
                excluded = True
        key = (r['sigungu'], r['dong'], r['jibun'], r['name'], int(r['area']))
        if excluded:
            excluded_keys.add(key)
        groups.setdefault(key, []).append(r)
    out = []
    for key, trades in groups.items():
        if key in excluded_keys:
            continue
        latest = max(trades, key=lambda r: (r['date'], r.get('floor') or 0))
        ratio = income_price_ratio(latest['price'], **pir)
        if ratio['status'] != 'within' or latest['price'] <= home_value:
            continue
        out.append({'id': hashlib.sha256('|'.join(map(str,key)).encode()).hexdigest()[:20],
                    'name': latest['name'], 'district': latest['district'], 'sigungu': latest['sigungu'],
                    'jibun': f"서울특별시 {latest['district']} {latest['dong']} {latest['jibun']}",
                    'area': latest['area'], 'price': latest['price'], 'date': latest['date'],
                    'build_year': latest.get('build_year'), 'dong': latest['dong'],
                    'home_gap': latest['price']-home_value, 'count': len(trades), 'pir': ratio, 'funding': capital_shortfall(latest['price'], net)})
    # Same-dong, same-size, similar-age peers; one median per complex avoids volume weighting.
    for item in out:
        peers=[]
        for key, trades in groups.items():
            last=max(trades,key=lambda r:r['date'])
            if (last['sigungu']!=item['sigungu'] or last['dong']!=item['dong'] or
                int(last['area'])!=int(item['area']) or last['name']==item['name'] or
                not last.get('build_year') or not item['build_year'] or
                abs(last['build_year']-item['build_year'])>peer_years):
                continue
            # Use the same latest observed contract month, not stale comparison prices.
            prices=[r['price'] for r in trades if r['date'][:7]==item['date'][:7]]
            if prices:
                peers.append({'name':last['name'],'median':int(median(prices))})
        benchmark=int(median([p['median'] for p in peers])) if len(peers)>=peer_min else None
        item['relative']={'peer_count':len(peers),'peers':peers,'median':benchmark,
                          'discount_pct':round((benchmark-item['price'])/benchmark*100,1) if benchmark else None,
                          'month':item['date'][:7]}
    def rank(item):
        relative = item['relative']['discount_pct']
        if ranking == 'price_high':
            return (-item['price'], -(relative or 0), -item['count'], item['name'])
        if ranking == 'budget_fit':
            return (abs(item['price']-net), -(relative or 0), -item['count'], item['name'])
        return (-(relative or 0), -item['count'], -item['price'], item['name'])
    out.sort(key=rank)
    if per_district:
        selected=[]
        for district in sorted({r['district'] for r in out}):
            ranked=sorted((r for r in out if r['district']==district), key=rank)
            # Different sizes of one complex should not take all three places.
            seen=set()
            for item in ranked:
                identity=(item['sigungu'],item['dong'],item['jibun'],item['name'])
                if identity in seen: continue
                seen.add(identity);selected.append(item)
                if len(seen)>=per_district: break
        return selected, len(out)
    return out[:limit], len(out)


def mark_spotlights(items, *, min_trades, min_peers):
    """One evidence-backed relative-price observation per district, never a prediction."""
    for item in items:
        item['spotlight'] = False
    for district in sorted({item['district'] for item in items}):
        eligible = [item for item in items if item['district'] == district
                    and item['count'] >= min_trades
                    and item['relative']['peer_count'] >= min_peers
                    and (item['relative']['discount_pct'] or 0) > 0]
        if eligible:
            best = min(eligible, key=lambda item: (-item['relative']['discount_pct'], -item['count'], item['name']))
            best['spotlight'] = True
    return items


def building_age(build_year, current_year):
    """Elapsed calendar years; the transaction source does not provide completion day."""
    if type(build_year) is not int or build_year <= 0 or build_year > current_year:
        return None
    return current_year - build_year
