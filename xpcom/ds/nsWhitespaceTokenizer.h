/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef __nsWhitespaceTokenizer_h
#define __nsWhitespaceTokenizer_h

#include "mozilla/RangedPtr.h"
#include "nsDependentSubstring.h"
#include "nsCRT.h"

template<typename SubstringType,
         typename DependentSubstringType,
         bool IsWhitespace(char16_t)>
class nsTWhitespaceTokenizer
{
  typedef typename SubstringType::char_type CharType;

public:
    nsTWhitespaceTokenizer(const SubstringType& aSource)
        : mIter(aSource.Data(), aSource.Length()),
          mEnd(aSource.Data() + aSource.Length(), aSource.Data(),
               aSource.Length()),
          mWhitespaceBeforeFirstToken(false),
          mWhitespaceAfterCurrentToken(false)
    {
        while (mIter < mEnd && IsWhitespace(*mIter)) {
            mWhitespaceBeforeFirstToken = true;
            ++mIter;
        }
    }

    /**
     * Checks if any more tokens are available.
     */
    bool hasMoreTokens() const
    {
        return mIter < mEnd;
    }

    /*
     * Returns true if there is whitespace prior to the first token.
     */
    bool whitespaceBeforeFirstToken() const
    {
        return mWhitespaceBeforeFirstToken;
    }

    /*
     * Returns true if there is any whitespace after the current token.
     * This is always true unless we're reading the last token.
     */
    bool whitespaceAfterCurrentToken() const
    {
        return mWhitespaceAfterCurrentToken;
    }

    /**
     * Returns the next token.
     */
    const DependentSubstringType nextToken()
    {
        const mozilla::RangedPtr<const CharType> tokenStart = mIter;
        while (mIter < mEnd && !IsWhitespace(*mIter)) {
            ++mIter;
        }
        const mozilla::RangedPtr<const CharType> tokenEnd = mIter;
        mWhitespaceAfterCurrentToken = false;
        while (mIter < mEnd && IsWhitespace(*mIter)) {
            mWhitespaceAfterCurrentToken = true;
            ++mIter;
        }
        return Substring(tokenStart.get(), tokenEnd.get());
    }

private:
    mozilla::RangedPtr<const CharType> mIter;
    const mozilla::RangedPtr<const CharType> mEnd;
    bool mWhitespaceBeforeFirstToken;
    bool mWhitespaceAfterCurrentToken;
};

template<bool IsWhitespace(char16_t) = NS_IsAsciiWhitespace>
class nsWhitespaceTokenizerTemplate
  : public nsTWhitespaceTokenizer<nsSubstring, nsDependentSubstring,
                                  IsWhitespace>
{
public:
  nsWhitespaceTokenizerTemplate(const nsSubstring& aSource)
    : nsTWhitespaceTokenizer<nsSubstring, nsDependentSubstring,
                             IsWhitespace>(aSource)
  {
  }
};

class nsWhitespaceTokenizer
  : public nsWhitespaceTokenizerTemplate<>
{
public:
  nsWhitespaceTokenizer(const nsSubstring& aSource)
    : nsWhitespaceTokenizerTemplate<>(aSource)
  {
  }
};

template<bool IsWhitespace(char16_t) = NS_IsAsciiWhitespace>
class nsCWhitespaceTokenizerTemplate
  : public nsTWhitespaceTokenizer<nsCSubstring, nsDependentCSubstring,
                                  IsWhitespace>
{
public:
  nsCWhitespaceTokenizerTemplate(const nsCSubstring& aSource)
    : nsTWhitespaceTokenizer<nsCSubstring, nsDependentCSubstring,
                             IsWhitespace>(aSource)
  {
  }
};

class nsCWhitespaceTokenizer
  : public nsCWhitespaceTokenizerTemplate<>
{
public:
  nsCWhitespaceTokenizer(const nsCSubstring& aSource)
    : nsCWhitespaceTokenizerTemplate<>(aSource)
  {
  }
};

#endif /* __nsWhitespaceTokenizer_h */
